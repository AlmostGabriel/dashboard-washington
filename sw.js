/* Service worker do sistema.
   Guarda o app no navegador para funcionar offline e troca de versão
   somente quando o usuário confirma. Nenhum dado do usuário passa por aqui:
   as planilhas e registros ficam no IndexedDB, que o service worker não toca. */
const VERSAO = '1.9.1';
const CACHE = 'dashwash-' + VERSAO;
const ARQUIVOS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n.startsWith('dashwash-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* Navegação: rede primeiro (pega a versão nova), cache como rede de segurança offline.
   Demais arquivos do próprio app: cache primeiro. Qualquer outro domínio passa direto. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', net.clone());
        return net;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const net = await fetch(req);
      if (net && net.ok && net.type === 'basic') (await caches.open(CACHE)).put(req, net.clone());
      return net;
    } catch (err) {
      return Response.error();
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'ATUALIZAR_AGORA') self.skipWaiting();
  if (e.data === 'VERSAO') e.source && e.source.postMessage({ versao: VERSAO });
});
