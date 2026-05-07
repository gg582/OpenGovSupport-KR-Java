import { contextBridge, ipcRenderer } from "electron";

/**
 * 안전한 렌더러 ↔ 메인 브리지. 렌더러는 status / openLogs 만 호출 가능.
 */
contextBridge.exposeInMainWorld("opengov", {
  status: () => ipcRenderer.invoke("opengov:status"),
  openLogs: () => ipcRenderer.invoke("opengov:openLogs"),
});
