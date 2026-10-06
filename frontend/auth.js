// Firebase handles credentials; the backend verifies every protected request.
(() => {
  let firebaseAuth, sdk, session = null, mode = null, epoch = 0;
  let controller = new AbortController();
  const base = window.CIVIC_API_BASE || "http://127.0.0.1:8000";
  const panel = () => document.getElementById("authStatus");
  async function timedFetch(url, options = {}) {
    const request = new AbortController();
    const cancel = () => request.abort();
    const signal = options.signal;
    let expired = false;
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, {once: true});
    const timer = setTimeout(() => { expired = true; request.abort(); }, url.endsWith("/analyze") ? 90000 : 30000);
    try {
      return await fetch(url, {...options, signal});
    } catch (error) {
      if (expired) throw new Error("The request took too long. Check your connection and try again.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  function publish(user) {
    session = user; epoch++; controller.abort(); controller = new AbortController();
    document.getElementById("appContent").hidden = !user;
    document.getElementById("signIn").hidden = Boolean(user) || mode === "local_demo";
    document.getElementById("signOut").hidden = !user || mode === "local_demo";
    document.getElementById("accountSection").hidden = mode === "local_demo";
    panel().textContent = mode === "local_demo" ? "Demo mode" : user ? "Signed in · " + (user.is_admin ? "Administrator" : "Community member") : "Sign in to submit and view civic reports.";
    window.dispatchEvent(new Event("civic-auth-changed"));
  }
  const state = window.CivicAuth = {
    get session() { return session; }, get epoch() { return epoch; },
    async request(url, options = {}) {
      await state.ready;
      if (!session) throw new Error("Sign in to use Civic Sentinel.");
      const started = epoch;
      const signal = controller.signal;
      const headers = new Headers(options.headers);
      if (mode === "firebase") headers.set("Authorization", "Bearer " + await firebaseAuth.currentUser.getIdToken());
      if (started !== epoch) throw new Error("Sign-in changed. Please retry.");
      const response = await timedFetch(url, {...options, headers, signal});
      const check = () => { if (started !== epoch) throw new Error("Sign-in changed. Please retry."); };
      check();
      for (const name of ["json", "blob"]) {
        const original = response[name].bind(response);
        response[name] = async () => { const result = await original(); check(); return result; };
      }
      return response;
    }
  };
  state.ready = (async () => {
    try {
      const response = await timedFetch(base + "/auth/config");
      if (!response.ok) throw new Error("Could not load sign-in settings.");
      const config = await response.json(); mode = config.mode;
      if (mode === "local_demo") {
        const me = await timedFetch(base + "/auth/me");
        if (!me.ok) throw new Error("Local demo is available only on this computer.");
        publish(await me.json()); return;
      }
      if (!config.firebase.apiKey || !config.firebase.appId) throw new Error("Firebase sign-in setup is incomplete.");
      const {initializeApp} = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js");
      sdk = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
      firebaseAuth = sdk.getAuth(initializeApp(config.firebase));
      await sdk.setPersistence(firebaseAuth, sdk.browserSessionPersistence);
      await new Promise(resolve => {
        sdk.onAuthStateChanged(firebaseAuth, async user => {
          publish(null);
          if (user) {
            const started = epoch;
            try {
              const token = await user.getIdToken();
              const me = await timedFetch(base + "/auth/me", {headers: {Authorization: "Bearer " + token}});
              const identity = await me.json();
              if (!me.ok) throw new Error(typeof identity.detail === "string" ? identity.detail : "Could not verify sign-in.");
              if (started === epoch) publish(identity);
            } catch (error) { if (started === epoch) panel().textContent = error.message; }
          }
          resolve();
        });
      });
    } catch (error) { panel().textContent = error.message === "Failed to fetch" ? "Start the backend, then reload to connect." : error.message; }
  })();
  document.getElementById("signIn").addEventListener("click", async () => {
    const button = document.getElementById("signIn"); button.disabled = true;
    try {
      await state.ready;
      if (!firebaseAuth) throw new Error("Sign-in setup is incomplete.");
      const provider = new sdk.GoogleAuthProvider(); provider.setCustomParameters({prompt: "select_account"});
      await sdk.signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      const messages = {"auth/popup-blocked": "Allow the sign-in popup, then try again.", "auth/popup-closed-by-user": "Sign-in cancelled. You can try again.", "auth/operation-not-allowed": "Google sign-in must be enabled in Firebase first.", "auth/unauthorized-domain": "This address must be added to Firebase’s authorized domains."};
      panel().textContent = messages[error.code] || "Sign-in failed. Check your connection and try again.";
    } finally { button.disabled = false; }
  });
  document.getElementById("signOut").addEventListener("click", async () => {
    publish(null);
    try { await sdk.signOut(firebaseAuth); }
    catch { panel().textContent = "Could not finish signing out. Close this browser tab."; }
  });
})();

