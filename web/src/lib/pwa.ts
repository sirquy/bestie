export function registerBestieServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(window.location.hostname)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.warn("Không thể đăng ký chế độ cài đặt Web UI.", error);
    });
  });
}
