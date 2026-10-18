import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'

const html = fs.readFileSync(new URL('../assets/window.html', import.meta.url), 'utf8')
const script = html.match(/window\.__dshwGetWindowRegion = function \(\) \{[\s\S]*?\n\}/)[0]
let nodes = []
const documentElement = {}
const context = vm.createContext({
  window: { innerWidth: 1000, innerHeight: 800 },
  document: { documentElement, querySelectorAll: () => nodes },
  getComputedStyle: node => node.style,
})
vm.runInContext(script, context)
function node(rect, { parent = documentElement, style = {}, name = 'dshwv-img' } = {}) {
  return { parentElement: parent, classList: [name], getBoundingClientRect: () => ({ left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] }),
    style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', ...style } }
}
const region = () => context.window.__dshwGetWindowRegion()
const whale = node([750, 550, 1000, 800], { name: 'dshwv-img' })
nodes = [node([500, 300, 1000, 800], { name: 'dshwv-root' }), whale]
assert.equal(region(), '1000,800;750,550,1000,800')
// Cursor position is irrelevant; switching windows cannot leave a fullscreen pane.
nodes.push(node([880, 680, 980, 780], { parent: whale }))
assert.equal(region(), '1000,800;750,550,1000,800')
const mask = node([0, 0, 1000, 800], { name: 'dshwv-bubmask' })
nodes.push(mask, node([200, 150, 600, 500], { parent: mask, name: 'dshwv-bubcard' }))
assert.equal(region(), '1000,800;750,550,1000,800;200,150,600,500')
mask.style.display = 'none'
assert.equal(region(), '1000,800;750,550,1000,800')
mask.style.display = 'flex'
mask.style.opacity = '0'
assert.equal(region(), '1000,800;750,550,1000,800')
nodes = [node([0, 0, 1000, 800], { name: 'dshwv-any-container' })]
assert.equal(region(), '1000,800')
const scroll = node([100, 100, 300, 300], { style: { overflowX: 'hidden', overflowY: 'auto' } })
nodes = [node([-50, -50, 1200, 2000], { parent: scroll })]
assert.equal(region(), '1000,800;100,100,300,300')
nodes = [node([-100, 200, 50, 250]), node([1500, 200, 1600, 300])]
assert.equal(region(), '1000,800;0,200,50,250')
nodes = [node([100, 100, 200, 200], { style: { visibility: 'hidden' } })]
assert.equal(region(), '1000,800')
nodes = Array.from({ length: 257 }, (_, i) => node([i * 3, 10, i * 3 + 1, 11]))
assert.equal(region(), '')
console.log('PASS: 10 DOM region cases (fullscreen masks, hidden ancestors, menus, clipping, offscreen, limits)')

// Exercise the actual HTTP wrapper and standalone HTML registration: opening the
// HTML endpoint must not issue a session or bypass a rejected request.
const host = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const wrapper = host.match(/function registerRoute\(route\) \{[\s\S]*?\n    \}/)[0]
const routeStart = host.indexOf("      path: '/dsh-whale/window.html'")
const routeBegin = host.lastIndexOf('    disposers.push(registerRoute({', routeStart)
const routeEnd = host.indexOf('\n    }))', routeStart) + '\n    }))'.length
let registered
const httpContext = vm.createContext({
  ctx: { webServer: { register: route => { registered = route } } }, disposers: [],
  rejected: (req, res) => { if (req.denied) { res.status = 401; res.end(); return true } return false },
  loadWindowPage: () => '<!doctype html><title>fixture</title>',
})
vm.runInContext(wrapper + '\n' + host.slice(routeBegin, routeEnd), httpContext)
function response() { return { status: null, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers }, end(body = '') { this.body = body } } }
let res = response()
await registered.handler({ denied: true }, res)
assert.equal(res.status, 401)
assert.equal(res.body, '')
res = response()
await registered.handler({ denied: false }, res)
assert.equal(res.status, 200)
assert.equal(Object.keys(res.headers).some(key => key.toLowerCase() === 'set-cookie'), false)

// Verify the private child-session format with a fake secret, without a Harness
// install, real credentials, or HTTP session-minting endpoint.
const mint = host.match(/function mintBrowserSessionCookie\(authority\) \{[\s\S]*?\n    \}/)[0]
const authContext = vm.createContext({ Buffer, createHash, createHmac,
  connectionFence: () => ({ browserAuth: { secret: 'test-only-secret', maxAgeMilliseconds: 60000 } }) })
vm.runInContext(mint, authContext)
const cookie = authContext.mintBrowserSessionCookie('127.0.0.1:12345')
const [name, value] = cookie.split('=')
const [version, payload, signature] = value.split('.')
assert.equal(version, 'v1')
assert.equal(name, 'dsh-auth-' + createHash('sha256').update('127.0.0.1:12345').digest('base64url'))
assert.equal(signature, createHmac('sha256', 'test-only-secret').update(payload).digest('base64url'))
const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
assert.equal(decoded.authority, '127.0.0.1:12345')
assert.equal(decoded.expiresAt - decoded.issuedAt, 60000)
console.log('PASS: standalone HTTP auth fence, no response cookie, private child session signature/authority/expiry')
