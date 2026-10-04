/**
 * Ask for the microphone now, inside the consent click where the person is looking, so the agent
 * starting later (from Open MiniERP) doesn't raise a prompt behind the MiniERP window.
 */
export function primeMicrophone() {
  navigator.mediaDevices
    ?.getUserMedia({ audio: true })
    .then((s) => s.getTracks().forEach((t) => t.stop()))
    .catch(() => {}); // denied: the agent reports the missing microphone when it starts
}
