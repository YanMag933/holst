window.HolstDB = (function () {
  const DB_NAME = "holst-studio";
  const DB_VER = 1;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function getFile(key) {
    return tx("files", "readonly").then(
      (st) =>
        new Promise((res, rej) => {
          const r = st.get(key);
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        })
    );
  }

  function putFile(key, blob) {
    return tx("files", "readwrite").then(
      (st) =>
        new Promise((res, rej) => {
          const r = st.put(blob, key);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        })
    );
  }

  function delFile(key) {
    return tx("files", "readwrite").then(
      (st) =>
        new Promise((res, rej) => {
          const r = st.delete(key);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        })
    );
  }

  function loadState() {
    return tx("meta", "readonly").then(
      (st) =>
        new Promise((res, rej) => {
          const r = st.get("state");
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        })
    );
  }

  function saveState(state) {
    return tx("meta", "readwrite").then(
      (st) =>
        new Promise((res, rej) => {
          const r = st.put(state, "state");
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        })
    );
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  }

  function blobUrl(blob) {
    return URL.createObjectURL(blob);
  }

  return { open, getFile, putFile, delFile, loadState, saveState, uid, blobUrl };
})();
