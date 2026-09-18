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
