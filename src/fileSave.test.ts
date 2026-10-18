import {
  isActivationError,
  pickSaveFileHandle,
  requestWritePermission,
  saveHandleAfterGesture,
  silentSaveIfGranted
} from './fileSave'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(isActivationError({ name: 'NotAllowedError', message: 'x' }), 'NotAllowedError is an activation error')
assert(isActivationError({ name: 'SecurityError', message: 'x' }), 'SecurityError is an activation error')
assert(
  isActivationError(new Error("Failed to execute 'createWritable' on 'FileSystemFileHandle': User activation is required to request permissions.")),
  'Chrome createWritable activation message is recognized'
)
assert(!isActivationError(new Error('disk full')), 'unrelated errors stay generic')

const order: string[] = []
let requestStarted = false
const handle = {
  name: 'Demo.musicalia',
  requestPermission: (opts: { mode: string }) => {
    requestStarted = true
    order.push(`requestPermission:${opts.mode}`)
    return new Promise<PermissionState>((resolve) => {
      queueMicrotask(() => resolve('granted'))
    })
  },
  queryPermission: () => {
    order.push('queryPermission')
    return Promise.resolve('prompt' as PermissionState)
  },
  createWritable: () => {
    order.push('createWritable')
    return Promise.resolve({
      write: async () => { order.push('write') },
      close: async () => { order.push('close') },
      abort: async () => { order.push('abort') }
    })
  }
}

const pending = saveHandleAfterGesture(handle, async () => {
  order.push('serialize')
  return new Blob(['zip'])
})
assert(requestStarted, 'requestPermission is invoked before the caller awaits the save')
assert(order[0] === 'requestPermission:readwrite', 'first call in the save path is requestPermission')
assert(!order.includes('serialize'), 'serialize has not started before the first await')

const result = await pending
assert(result.ok === true, 'granted handle writes the blob')
assert(
  order.join('>') === 'requestPermission:readwrite>createWritable>serialize>write>close',
  `permission and createWritable happen before serialize, got ${order.join('>')}`
)

const denied = await saveHandleAfterGesture({
  requestPermission: () => Promise.resolve('denied' as PermissionState),
  createWritable: async () => {
    throw new Error('createWritable should not run when denied')
  }
}, async () => new Blob(['no']))
assert(denied.ok === false && denied.reason === 'denied', 'denied permission does not write')

const activation = await saveHandleAfterGesture({
  requestPermission: () => Promise.resolve('granted' as PermissionState),
  createWritable: async () => {
    throw Object.assign(new Error("Failed to execute 'createWritable' on 'FileSystemFileHandle': User activation is required to request permissions."), { name: 'NotAllowedError' })
  }
}, async () => new Blob(['no']))
assert(activation.ok === false && activation.reason === 'activation', 'createWritable activation errors are classified')

let requestedDuringSilent = false
const skipped = await silentSaveIfGranted({
  queryPermission: () => Promise.resolve('prompt' as PermissionState),
  requestPermission: () => {
    requestedDuringSilent = true
    return Promise.resolve('granted' as PermissionState)
  },
  createWritable: async () => {
    throw new Error('silent save must not open a writable when permission is prompt')
  }
}, async () => new Blob(['x']))
assert(skipped === 'skipped', 'autosave skips when permission is not granted')
assert(!requestedDuringSilent, 'autosave never calls requestPermission')

const silentOrder: string[] = []
const silentSaved = await silentSaveIfGranted({
  queryPermission: () => {
    silentOrder.push('query')
    return Promise.resolve('granted' as PermissionState)
  },
  requestPermission: () => {
    silentOrder.push('request')
    return Promise.resolve('granted' as PermissionState)
  },
  createWritable: () => {
    silentOrder.push('create')
    return Promise.resolve({
      write: async () => { silentOrder.push('write') },
      close: async () => { silentOrder.push('close') }
    })
  }
}, async () => {
  silentOrder.push('serialize')
  return new Blob(['x'])
})
assert(silentSaved === 'saved', 'autosave writes only when already granted')
assert(!silentOrder.includes('request'), 'granted autosave still skips requestPermission')

const pickerCalls: string[] = []
const picked = await pickSaveFileHandle('tema.musicalia', async (opts) => {
  pickerCalls.push(opts.suggestedName)
  return { name: opts.suggestedName }
})
assert(picked.name === 'tema.musicalia', 'Guardar como uses showSaveFilePicker')
assert(pickerCalls[0] === 'tema.musicalia', 'picker suggested name is the project file')

const perm = requestWritePermission({
  requestPermission: () => Promise.resolve('granted' as PermissionState)
})
assert(perm instanceof Promise, 'requestWritePermission returns the browser promise immediately')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ file save unit tests passed')
