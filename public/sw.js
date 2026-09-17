const CACHE_NAME = "prospeccao-shell-v1";
const OFFLINE_URL = "/offline.html";

// Só guarda o essencial pra mostrar uma tela de "sem conexão" decente —
// os dados de verdade vêm sempre do Supabase, então não faz sentido (nem
// seria seguro) cachear a tabela de empresas ou a sessão de login aqui.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((c) => c !== CACHE_NAME).map((c) => caches.delete(c)))
      )
      .then(() => self.clients.claim())
  );
});

// Estratégia network-first: sempre tenta a rede primeiro (pra nunca mostrar
// dado desatualizado); só recorre ao cache/offline.html se a rede falhar.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((resposta) => resposta || caches.match(OFFLINE_URL))
    )
  );
});
