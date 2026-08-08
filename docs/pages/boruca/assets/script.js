(function () {
  "use strict";

  var ALL = (window.VOCAB_DATA && VOCAB_DATA.entries) || [];
  var FACETS = (window.VOCAB_DATA && VOCAB_DATA.facets) || {};
  var BY_ID = {};
  ALL.forEach(function (e) { BY_ID[e.id] = e; });

  var POS_ABBR = {
    "noun": "n",
    "verb": "v",
    "adjective": "adj",
    "adverb": "adv",
    "adverbial locution": "adv. loc.",
    "article": "art",
    "augmentative": "augm",
    "conjunction": "conj",
    "demonstrative": "dem",
    "idiom": "idiom",
    "interjection": "interj",
    "interrogative": "interr",
    "locution": "loc",
    "noun phrase": "n. phr.",
    "numeral": "num",
    "particle": "part",
    "postposition": "postp",
    "postpositional locution": "postp. loc.",
    "postpositional phrase": "postp. phr.",
    "pronoun": "pron",
    "unclassified": "—"
  };

  var searchInput = document.getElementById("search");
  var posSelect = document.getElementById("filter-pos");
  var morphSelect = document.getElementById("filter-morph");
  var domainSelect = document.getElementById("filter-domain");
  var listEl = document.getElementById("word-list");
  var panelEl = document.getElementById("entry-panel");
  var countEl = document.getElementById("count");
  var editsBarEl = document.getElementById("edits-bar");
  var editsCountEl = document.getElementById("edits-count");
  var editsExportBtn = document.getElementById("edits-export");
  var editsClearBtn = document.getElementById("edits-clear");

  // ---- Local edits (browser-only; this is a static, offline site with no
  // server to write back to). Corrections are kept in localStorage, keyed by
  // entry id, as a set of {old, new} pairs per changed field — never
  // mutating ALL/BY_ID directly, so the "export edits" file always has a
  // clean before/after to hand back for merging into boruca_vocabulary.db.
  var EDITS_KEY = "borucaVocabEdits_v1";
  var EDITABLE_FIELDS = [
    { key: "headword", label: "Headword", type: "text" },
    { key: "part_of_speech", label: "Part of speech", type: "text" },
    { key: "part_of_speech_subtype", label: "Subtype", type: "text" },
    { key: "gloss_es", label: "Gloss (Spanish)", type: "textarea" },
    { key: "gloss_en", label: "Gloss (English)", type: "textarea" },
    { key: "example_boruca", label: "Example (Boruca)", type: "textarea" },
    { key: "example_translation_es", label: "Example translation", type: "textarea" },
    { key: "etymology", label: "Etymology", type: "textarea" },
    { key: "notes", label: "Notes", type: "textarea" }
  ];

  function loadEdits() {
    try {
      var raw = localStorage.getItem(EDITS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }
  function persistEdits() {
    try {
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
    } catch (err) {
      /* storage unavailable (e.g. private browsing) — edits stay in-memory only */
    }
  }
  var edits = loadEdits();

  function effectiveEntry(id) {
    var base = BY_ID[id];
    if (!base) return base;
    var edit = edits[id];
    if (!edit) return base;
    var merged = Object.assign({}, base);
    Object.keys(edit.changes).forEach(function (field) {
      merged[field] = edit.changes[field].new;
    });
    return merged;
  }

  function editsCount() {
    return Object.keys(edits).length;
  }

  function refreshEditsBar() {
    var n = editsCount();
    if (!n) {
      editsBarEl.hidden = true;
      return;
    }
    editsBarEl.hidden = false;
    editsCountEl.textContent = n + (n === 1 ? " word edited locally" : " words edited locally");
  }

  function downloadJSON(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  editsExportBtn.addEventListener("click", function () {
    var out = Object.keys(edits).map(function (id) {
      var edit = edits[id];
      return {
        id: Number(id),
        headword: effectiveEntry(id).headword,
        edited_at: edit.edited_at,
        changes: edit.changes
      };
    });
    var stamp = new Date().toISOString().slice(0, 10);
    downloadJSON("boruca-dictionary-edits-" + stamp + ".json", out);
  });

  editsClearBtn.addEventListener("click", function () {
    if (!confirm("Discard all " + editsCount() + " local edit(s)? This can't be undone — export first if you want to keep a copy.")) return;
    edits = {};
    persistEdits();
    refreshEditsBar();
    applyFilters();
    if (state.selectedId != null) selectEntry(state.selectedId, { scroll: false });
  });

  function fillSelect(select, values) {
    values.forEach(function (v) {
      if (!v) return;
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = prettify(v);
      select.appendChild(opt);
    });
  }

  function prettify(slug) {
    return String(slug).replace(/_/g, " ");
  }

  fillSelect(posSelect, FACETS.partOfSpeech || []);
  fillSelect(morphSelect, FACETS.morphologyType || []);
  fillSelect(domainSelect, FACETS.semanticDomain || []);

  var state = { query: "", pos: "", morph: "", domain: "", selectedId: null, editingId: null };
  var filtered = ALL;

  function normalize(s) {
    return (s || "").toString().toLowerCase();
  }

  function groupLetter(headword) {
    var stripped = (headword || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    var m = stripped.match(/[a-z]/i);
    return m ? m[0].toUpperCase() : "#";
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatIndex(id) {
    return String(id).padStart(5, "0");
  }

  function posLabel(e) {
    if (!e.part_of_speech) return "";
    var abbr = POS_ABBR[e.part_of_speech] || e.part_of_speech;
    return e.part_of_speech_subtype ? abbr + " (" + e.part_of_speech_subtype + ")" : abbr;
  }

  function applyFilters() {
    var q = normalize(state.query);
    filtered = ALL.filter(function (base) {
      var e = effectiveEntry(base.id);
      if (state.pos && e.part_of_speech !== state.pos) return false;
      if (state.morph && e.morphology_type !== state.morph) return false;
      if (state.domain && e.semantic_domain !== state.domain) return false;
      if (!q) return true;
      return (
        normalize(e.headword).indexOf(q) !== -1 ||
        normalize(e.headword_original).indexOf(q) !== -1 ||
        normalize(e.gloss_es).indexOf(q) !== -1 ||
        normalize(e.gloss_en).indexOf(q) !== -1
      );
    });
    renderList();
  }

  function renderList() {
    countEl.textContent = filtered.length.toLocaleString() + " / " + ALL.length.toLocaleString() + " words";

    if (!filtered.length) {
      listEl.innerHTML = '<div class="no-results">No words match.</div>';
      return;
    }

    var html = [];
    var lastLetter = null;
    filtered.forEach(function (base) {
      var e = effectiveEntry(base.id);
      var letter = groupLetter(e.headword);
      if (letter !== lastLetter) {
        html.push('<div class="letter-header">' + escapeHtml(letter) + "</div>");
        lastLetter = letter;
      }
      var glossPreview = e.gloss_es || e.gloss_en || "";
      var activeClass = e.id === state.selectedId ? " active" : "";
      html.push(
        '<div class="word-item' + activeClass + '" data-id="' + e.id + '" role="button" tabindex="0">' +
          '<span class="w-head">' + escapeHtml(e.headword) + "</span>" +
          (e.part_of_speech ? '<span class="w-pos">' + escapeHtml(posLabel(e)) + "</span>" : "") +
          (edits[e.id] ? '<span class="w-edited">edited</span>' : "") +
          (glossPreview ? '<span class="w-gloss">' + escapeHtml(glossPreview) + "</span>" : "") +
          "</div>"
      );
    });
    listEl.innerHTML = html.join("");
  }

  function relatedRow(label, content) {
    return (
      '<p class="related-row"><span class="arrow">&#9656;</span>' +
      '<span class="label">' + escapeHtml(label) + "</span>" +
      content +
      "</p>"
    );
  }

  function renderDetail(entry) {
    var parts = [];
    parts.push('<article class="dict-entry">');

    parts.push('<div class="dict-entry-head">');
    parts.push('<span class="dict-headword">' + escapeHtml(entry.headword) + "</span>");
    if (entry.part_of_speech) {
      parts.push('<span class="pos-abbr">' + escapeHtml(posLabel(entry)) + "</span>");
    }
    if (entry.tone_marked) parts.push('<span class="tag">tone</span>');
    if (edits[entry.id]) {
      parts.push('<span class="edited-badge">edited</span>');
      parts.push('<button type="button" class="btn btn-ghost" data-action="revert" data-id="' + entry.id + '">Revert</button>');
    }
    if (entry.headword_original && entry.headword_original !== entry.headword) {
      parts.push('<span class="dict-original">orig. ' + escapeHtml(entry.headword_original) + "</span>");
    }
    parts.push(
      '<button type="button" class="btn edit-toggle" data-action="edit" data-id="' + entry.id + '">Edit</button>'
    );
    parts.push("</div>");

    if (entry.gloss_es) parts.push('<p class="def-es">' + escapeHtml(entry.gloss_es) + "</p>");
    if (entry.gloss_en) parts.push('<p class="def-en">' + escapeHtml(entry.gloss_en) + "</p>");

    if (entry.example_boruca) {
      parts.push('<div class="example-block"><span class="example-boruca">' + escapeHtml(entry.example_boruca) + "</span>");
      if (entry.example_translation_es) {
        parts.push('<span class="example-es">' + escapeHtml(entry.example_translation_es) + "</span>");
      }
      parts.push("</div>");
    }

    if (entry.morphology_type && entry.morphology_type !== "simple_root") {
      parts.push(
        relatedRow(
          "word formation",
          escapeHtml(prettify(entry.morphology_type)) +
            (entry.morphology_analysis ? " — " + escapeHtml(entry.morphology_analysis) : "")
        )
      );
    }
    if (entry.etymology) parts.push(relatedRow("etymology", escapeHtml(entry.etymology)));
    if (entry.notes) parts.push(relatedRow("notes", escapeHtml(entry.notes)));

    var meta = [];
    if (entry.semantic_domain) meta.push("<b>domain</b> " + escapeHtml(prettify(entry.semantic_domain)));
    if (entry.source) meta.push("<b>source</b> " + escapeHtml(entry.source));
    if (meta.length) {
      parts.push('<div class="entry-footer-meta">' + meta.map(function (m) { return "<span>" + m + "</span>"; }).join("") + "</div>");
    }
    parts.push('<div class="dict-index-row"><b>index</b> #' + formatIndex(entry.id) + "</div>");

    parts.push("</article>");
    panelEl.innerHTML = parts.join("");
  }

  function fieldInputHtml(field, value) {
    var val = escapeHtml(value || "");
    if (field.type === "textarea") {
      return '<textarea name="' + field.key + '" rows="3">' + val + "</textarea>";
    }
    return '<input type="text" name="' + field.key + '" value="' + val + '">';
  }

  function renderEditForm(entry) {
    var parts = [];
    parts.push('<form class="edit-form" data-id="' + entry.id + '">');
    parts.push('<div class="dict-entry-head"><span class="dict-headword">Editing: ' + escapeHtml(entry.headword) + "</span></div>");

    EDITABLE_FIELDS.forEach(function (field) {
      parts.push('<div class="edit-field"><label>' + escapeHtml(field.label) + "</label>" + fieldInputHtml(field, entry[field.key]) + "</div>");
    });

    parts.push('<div class="edit-actions">');
    parts.push('<button type="submit" class="btn btn-primary">Save locally</button>');
    parts.push('<button type="button" class="btn btn-ghost" data-action="cancel-edit">Cancel</button>');
    parts.push('<span class="save-status">Saved to this browser only — export when you\'re ready to send corrections back.</span>');
    parts.push("</div>");
    parts.push("</form>");
    panelEl.innerHTML = parts.join("");
    var firstInput = panelEl.querySelector(".edit-form input, .edit-form textarea");
    if (firstInput) firstInput.focus();
  }

  function commitEdit(id, formEl) {
    var base = BY_ID[id];
    if (!base) return;
    var current = effectiveEntry(id);
    var changes = (edits[id] && edits[id].changes) ? Object.assign({}, edits[id].changes) : {};

    EDITABLE_FIELDS.forEach(function (field) {
      var input = formEl.elements[field.key];
      if (!input) return;
      var newVal = input.value.trim();
      var oldBaseVal = (base[field.key] || "").toString();
      if (newVal === oldBaseVal || (!newVal && !oldBaseVal)) {
        delete changes[field.key];
      } else {
        var priorOld = changes[field.key] ? changes[field.key].old : oldBaseVal;
        changes[field.key] = { old: priorOld, new: newVal };
      }
    });

    if (Object.keys(changes).length) {
      edits[id] = { changes: changes, edited_at: new Date().toISOString() };
    } else {
      delete edits[id];
    }
    persistEdits();
    refreshEditsBar();
  }

  function selectEntry(id, opts) {
    id = Number(id);
    var base = BY_ID[id];
    if (!base) return;

    var prevActive = listEl.querySelector(".word-item.active");
    if (prevActive) prevActive.classList.remove("active");
    state.selectedId = id;
    state.editingId = null;
    var nextActive = listEl.querySelector('.word-item[data-id="' + id + '"]');
    if (nextActive) {
      nextActive.classList.add("active");
      if (!opts || opts.scroll !== false) {
        nextActive.scrollIntoView({ block: "nearest" });
      }
    }

    renderDetail(effectiveEntry(id));
    history.replaceState(null, "", "#e-" + id);
  }

  panelEl.addEventListener("click", function (evt) {
    var btn = evt.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;
    var id = Number(btn.dataset.id != null ? btn.dataset.id : state.selectedId);

    if (action === "edit") {
      state.editingId = id;
      renderEditForm(effectiveEntry(id));
    } else if (action === "cancel-edit") {
      state.editingId = null;
      renderDetail(effectiveEntry(id));
    } else if (action === "revert") {
      if (confirm("Discard your local edit to this word and restore the original?")) {
        delete edits[id];
        persistEdits();
        refreshEditsBar();
        applyFilters();
        renderDetail(effectiveEntry(id));
      }
    }
  });

  panelEl.addEventListener("submit", function (evt) {
    var form = evt.target.closest(".edit-form");
    if (!form) return;
    evt.preventDefault();
    var id = Number(form.dataset.id);
    commitEdit(id, form);
    state.editingId = null;
    applyFilters();
    renderDetail(effectiveEntry(id));
  });

  listEl.addEventListener("click", function (evt) {
    var item = evt.target.closest(".word-item");
    if (item) selectEntry(item.dataset.id);
  });
  listEl.addEventListener("keydown", function (evt) {
    if (evt.key !== "Enter" && evt.key !== " ") return;
    var item = evt.target.closest(".word-item");
    if (item) {
      evt.preventDefault();
      selectEntry(item.dataset.id);
    }
  });

  var debounceTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    var val = searchInput.value;
    debounceTimer = setTimeout(function () {
      state.query = val;
      applyFilters();
    }, 120);
  });
  searchInput.addEventListener("keydown", function (evt) {
    if (evt.key === "Enter" && filtered.length) {
      selectEntry(filtered[0].id);
    }
  });

  posSelect.addEventListener("change", function () {
    state.pos = posSelect.value;
    applyFilters();
  });
  morphSelect.addEventListener("change", function () {
    state.morph = morphSelect.value;
    applyFilters();
  });
  domainSelect.addEventListener("change", function () {
    state.domain = domainSelect.value;
    applyFilters();
  });

  applyFilters();
  refreshEditsBar();

  var hashMatch = /^#e-(\d+)$/.exec(location.hash);
  var qParam = new URLSearchParams(location.search).get("q");
  if (hashMatch && BY_ID[hashMatch[1]]) {
    selectEntry(hashMatch[1]);
  } else if (qParam) {
    // Arrived from a dictionary link for a headword with multiple entries
    // (a homograph) — show all matches in the list instead of guessing one.
    searchInput.value = qParam;
    state.query = qParam;
    applyFilters();
    if (filtered.length) selectEntry(filtered[0].id, { scroll: false });
  } else if (ALL.length) {
    selectEntry(ALL[0].id, { scroll: false });
  }
})();
