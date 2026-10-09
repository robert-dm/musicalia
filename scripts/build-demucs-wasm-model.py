#!/usr/bin/env python3
"""Build a WASM-friendly HT-Demucs 6s ONNX.

Starts from StemSplitio htdemucs_6s_fp16weights.onnx:
1. Offline BASIC graph optimization (folds 24k nodes → ~1.4k). That is
   what actually OOMs wasm32 session create — not the 55 MB of weights.
2. Store large float weights as fp16 + Cast so each hosted file stays
   under GitHub/Vercel's 100 MB cap (STFT kernels in the .data file).
"""
from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from onnx.external_data_helper import convert_model_to_external_data
import onnxruntime as ort

DEMUCS_N_SAMPLES = 343980


def rss_note():
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def optimize_basic(src: Path, out: Path) -> None:
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    so.optimized_model_filepath = str(out)
    so.enable_cpu_mem_arena = False
    so.enable_mem_pattern = False
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.add_session_config_entry("session.disable_prepacking", "1")
    so.log_severity_level = 2
    t0 = time.time()
    sess = ort.InferenceSession(str(src), so, providers=["CPUExecutionProvider"])
    del sess
    print(f"optimized BASIC in {time.time()-t0:.1f}s rss={rss_note():.0f}MB size={out.stat().st_size}", flush=True)


def rewrite(model: onnx.ModelProto) -> onnx.ModelProto:
    inits = {init.name: init for init in model.graph.initializer}
    new_inits: list[onnx.TensorProto] = []
    skip: set[str] = set()
    prefix_nodes: list[onnx.NodeProto] = []
    n_fp16 = 0

    for name, init in list(inits.items()):
        arr = numpy_helper.to_array(init)
        if arr.dtype != np.float32 or arr.size < 16:
            continue
        if arr.size < 64:
            continue
        fp16 = numpy_helper.from_array(arr.astype(np.float16), name + "__fp16")
        new_inits.append(fp16)
        prefix_nodes.append(helper.make_node(
            "Cast", [name + "__fp16"], [name], to=TensorProto.FLOAT, name=name + "__CastFp16"
        ))
        skip.add(name)
        n_fp16 += 1

    kept = [init for init in model.graph.initializer if init.name not in skip]
    del model.graph.initializer[:]
    model.graph.initializer.extend(kept)
    model.graph.initializer.extend(new_inits)
    nodes = list(prefix_nodes) + list(model.graph.node)
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    print(f"rewrote fp16_cast={n_fp16} nodes={len(model.graph.node)} inits={len(model.graph.initializer)}")
    return model


def parity(orig: Path, built: Path) -> None:
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    so.enable_cpu_mem_arena = False
    so.enable_mem_pattern = False
    so.intra_op_num_threads = 1
    so.add_session_config_entry("session.disable_prepacking", "1")
    mix = np.zeros((1, 2, DEMUCS_N_SAMPLES), np.float32)
    t = np.arange(DEMUCS_N_SAMPLES, dtype=np.float32)
    mix[0, 0] = 0.2 * np.sin(2 * np.pi * 220 * t / 44100) + 0.15 * np.sin(2 * np.pi * 80 * t / 44100)
    mix[0, 1] = mix[0, 0] * 0.92

    t0 = time.time()
    a = ort.InferenceSession(str(orig), so, providers=["CPUExecutionProvider"]).run(None, {"mix": mix})[0]
    print("orig infer done", round(time.time() - t0, 2), "s")
    t0 = time.time()
    b = ort.InferenceSession(str(built), so, providers=["CPUExecutionProvider"]).run(None, {"mix": mix})[0]
    print("wasm infer done", round(time.time() - t0, 2), "s")
    diff = np.abs(a - b)
    print("max_abs", float(diff.max()), "mean_abs", float(diff.mean()))
    print("orig peak", [float(np.max(np.abs(a[0, i]))) for i in range(6)])
    print("wasm peak", [float(np.max(np.abs(b[0, i]))) for i in range(6)])
    assert b.shape == a.shape
    assert np.isfinite(b).all()
    assert float(diff.max()) < 5e-3, float(diff.max())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", default="/tmp/musicalia-verify/htdemucs_6s_fp16weights.onnx")
    p.add_argument("--work", default="/tmp/musicalia-verify")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--skip-parity", action="store_true")
    args = p.parse_args()
    src = Path(args.src)
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    basic = work / "htdemucs_6s_basic.onnx"
    if not basic.exists():
        optimize_basic(src, basic)
    else:
        print("using cached", basic)

    model = onnx.load(str(basic), load_external_data=True)
    model = rewrite(model)

    tmp_onnx = work / "htdemucs_6s_wasm_packed.onnx"
    onnx.save(model, str(tmp_onnx))
    print("packed", tmp_onnx.stat().st_size)

    packed = onnx.load(str(tmp_onnx))
    # Only the four STFT/iSTFT fp16 kernels (~17 MB each) go external so each
    # GitHub/Vercel blob stays under the 100 MB file cap. Int8 weights stay in the .onnx.
    convert_model_to_external_data(
        packed,
        all_tensors_to_one_file=True,
        location="htdemucs_6s_wasm.onnx.data",
        size_threshold=8 * 1024 * 1024,
        convert_attribute=False,
    )
    out_onnx = out_dir / "htdemucs_6s_wasm.onnx"
    # Save into out_dir so the .data file lands next to it.
    onnx.save(packed, str(out_onnx))
    data = out_dir / "htdemucs_6s_wasm.onnx.data"
    print("out onnx", out_onnx.stat().st_size, "data", data.stat().st_size if data.exists() else 0)

    if not args.skip_parity:
        parity(src, out_onnx)
    print("OK rss", round(rss_note(), 1))


if __name__ == "__main__":
    main()
