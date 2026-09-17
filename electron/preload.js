const { contextBridge, ipcRenderer } = require("electron");

// Ponte exposta ao site (renderer) de forma segura — o site nunca tem
// acesso direto ao Node/child_process, só a essas quatro funções.
contextBridge.exposeInMainWorld("electronAPI", {
  iniciarAtualizacaoCnpj: (params) => ipcRenderer.send("atualizacao:iniciar", params),
  pararAtualizacaoCnpj: () => ipcRenderer.send("atualizacao:parar"),
  onAtualizacaoLog: (callback) => {
    const ouvinte = (_evento, linha) => callback(linha);
    ipcRenderer.on("atualizacao:log", ouvinte);
    return () => ipcRenderer.removeListener("atualizacao:log", ouvinte);
  },
  onAtualizacaoFim: (callback) => {
    const ouvinte = (_evento, codigo) => callback(codigo);
    ipcRenderer.on("atualizacao:fim", ouvinte);
    return () => ipcRenderer.removeListener("atualizacao:fim", ouvinte);
  },
});
