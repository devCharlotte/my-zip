const PREFIX = "sequence-studio:";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {}
}

export const store = {
  favorites: () => new Set(read("favorites", [])),
  saveFavorites: (set) => write("favorites", [...set]),

  draft: () => read("draft", { title: "", items: [] }),
  saveDraft: (seq) => write("draft", seq),

  saved: () => read("saved", []),
  saveSaved: (list) => write("saved", list),

  prefs: () => ({ voice: false, recorded: true, large: false, voiceName: "", rate: 1, detail: "standard", effect: "bell", ...read("prefs", {}) }),
  savePrefs: (prefs) => write("prefs", prefs),
};
