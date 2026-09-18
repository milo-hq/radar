const token = document.getElementById("token"),
  status = document.getElementById("status");
const state = await chrome.storage.local.get(["token", "message"]);
token.value = state.token || "";
status.textContent = state.message || "尚未连接";
for (const type of ["start", "stop"])
  document.getElementById(type).onclick = async () => {
    try {
      const r = await chrome.runtime.sendMessage({
        type,
        token: token.value.trim(),
      });
      status.textContent = r.error || "已更新";
    } catch (e) {
      status.textContent = e.message;
    }
  };
chrome.storage.onChanged.addListener((changes) => {
  if (changes.message) status.textContent = changes.message.newValue;
});

document.getElementById("enable-x").onclick = async () => {
  try {
    const granted = await chrome.permissions.request({
      origins: ["https://x.com/*"],
    });
    status.textContent = granted
      ? "X 权限已启用，请点连接 / 继续。"
      : "未授予 X 权限";
  } catch (e) {
    status.textContent = e.message;
  }
};
document.getElementById("disable-x").onclick = async () => {
  await chrome.permissions.remove({ origins: ["https://x.com/*"] });
  status.textContent = "X 权限已关闭";
};
