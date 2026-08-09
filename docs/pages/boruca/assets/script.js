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
  var statusSelect = document.getElementById("filter-status");
  var dupCheckbox = document.getElementById("filter-dup");
  var dupTotalEl = document.getElementById("dup-total");
  var headwordDupCheckbox = document.getElementById("filter-headword-dup");
  var headwordDupTotalEl = document.getElementById("headword-dup-total");
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

  // Deletions and review marks follow the exact same "local override,
  // never mutate ALL/BY_ID, exportable, revertible" pattern as edits above
  // — each just lives under its own localStorage key so they can be
  // cleared/exported independently if needed, though the UI treats all
  // three as one combined "local changes" set (see refreshChangesBar).
  var DELETIONS_KEY = "borucaVocabDeletions_v1";
  var REVIEWS_KEY = "borucaVocabReviews_v1";

  function loadJSONStore(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }
  function persistJSONStore(key, store) {
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch (err) {
      /* storage unavailable (e.g. private browsing) — stays in-memory only */
    }
  }

  function loadEdits() { return loadJSONStore(EDITS_KEY); }
  function persistEdits() { persistJSONStore(EDITS_KEY, edits); }
  var edits = loadEdits();

  function persistDeletions() { persistJSONStore(DELETIONS_KEY, deletions); }
  var deletions = loadJSONStore(DELETIONS_KEY);

  function persistReviews() { persistJSONStore(REVIEWS_KEY, reviews); }
  var reviews = loadJSONStore(REVIEWS_KEY);

  function isDeleted(id) {
    return Object.prototype.hasOwnProperty.call(deletions, id);
  }

  function effectiveEntry(id) {
    var base = BY_ID[id];
    if (!base) return base;
    var merged = Object.assign({}, base);
    var edit = edits[id];
    if (edit) {
      Object.keys(edit.changes).forEach(function (field) {
        merged[field] = edit.changes[field].new;
      });
    }
    if (reviews[id]) merged.project_review_status = reviews[id].status;
    return merged;
  }

  // Union of every id touched by an edit, a deletion, or a review mark —
  // one combined count for the "local changes" bar, since from the user's
  // point of view these are all just "things I did in this browser that
  // still need to be exported and applied to the real database."
  function changedIds() {
    var ids = {};
    Object.keys(edits).forEach(function (id) { ids[id] = true; });
    Object.keys(deletions).forEach(function (id) { ids[id] = true; });
    Object.keys(reviews).forEach(function (id) { ids[id] = true; });
    return Object.keys(ids);
  }

  function refreshChangesBar() {
    var n = changedIds().length;
    if (!n) {
      editsBarEl.hidden = true;
      return;
    }
    editsBarEl.hidden = false;
    var parts = [];
    var editCount = Object.keys(edits).length;
    var delCount = Object.keys(deletions).length;
    var revCount = Object.keys(reviews).length;
    if (editCount) parts.push(editCount + " edited");
    if (delCount) parts.push(delCount + " deleted");
    if (revCount) parts.push(revCount + " review-marked");
    editsCountEl.textContent = n + (n === 1 ? " word changed locally" : " words changed locally") + " (" + parts.join(", ") + ")";
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
    var out = {
      exported_at: new Date().toISOString(),
      edits: Object.keys(edits).map(function (id) {
        var edit = edits[id];
        return {
          id: Number(id),
          headword: (effectiveEntry(id) || BY_ID[id] || {}).headword,
          edited_at: edit.edited_at,
          changes: edit.changes
        };
      }),
      deletions: Object.keys(deletions).map(function (id) {
        return {
          id: Number(id),
          headword: (BY_ID[id] || {}).headword,
          deleted_at: deletions[id].deleted_at
        };
      }),
      reviews: Object.keys(reviews).map(function (id) {
        return {
          id: Number(id),
          headword: (BY_ID[id] || {}).headword,
          status: reviews[id].status,
          reviewed_at: reviews[id].reviewed_at
        };
      })
    };
    var stamp = new Date().toISOString().slice(0, 10);
    downloadJSON("boruca-dictionary-changes-" + stamp + ".json", out);
  });

  editsClearBtn.addEventListener("click", function () {
    var n = changedIds().length;
    if (!confirm("Discard all " + n + " local change(s) (edits, deletions, and review marks)? This can't be undone — export first if you want to keep a copy.")) return;
    edits = {};
    deletions = {};
    reviews = {};
    persistEdits();
    persistDeletions();
    persistReviews();
    refreshChangesBar();
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

  var state = { query: "", pos: "", morph: "", domain: "", status: "", dupOnly: false, headwordDupOnly: false, selectedId: null, editingId: null };
  var filtered = ALL;

  var TOTAL_DUP_ENTRIES = ALL.reduce(function (n, e) { return (e.dup_group || e.exact_dup_group) ? n + 1 : n; }, 0);
  if (dupTotalEl) dupTotalEl.textContent = TOTAL_DUP_ENTRIES ? "(" + TOTAL_DUP_ENTRIES.toLocaleString() + ")" : "";

  // Broadest tier: any 2+ active entries sharing the exact same headword
  // string, regardless of gloss -- a triage queue mixing genuine polysemous
  // roots with leftover batch-reimport duplicates the exact-match detector
  // misses (see build_docs_content.py's headword_group comment).
  var TOTAL_HEADWORD_DUP_ENTRIES = ALL.reduce(function (n, e) { return e.headword_group ? n + 1 : n; }, 0);
  if (headwordDupTotalEl) headwordDupTotalEl.textContent = TOTAL_HEADWORD_DUP_ENTRIES ? "(" + TOTAL_HEADWORD_DUP_ENTRIES.toLocaleString() + ")" : "";

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
      var deleted = isDeleted(base.id);
      // "Deleted (locally)" is a special view for reviewing/undoing your own
      // deletions — everywhere else, locally-deleted entries are hidden.
      if (state.status === "deleted") return deleted;
      if (deleted) return false;

      var e = effectiveEntry(base.id);
      if (state.pos && e.part_of_speech !== state.pos) return false;
      if (state.morph && e.morphology_type !== state.morph) return false;
      if (state.domain && e.semantic_domain !== state.domain) return false;
      if (state.status === "reviewed" && e.project_review_status !== "reviewed") return false;
      if (state.status === "unreviewed" && e.project_review_status === "reviewed") return false;
      if (state.dupOnly && !e.dup_group && !e.exact_dup_group) return false;
      if (state.headwordDupOnly && !e.headword_group) return false;
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
      var exactDupClass = e.exact_dup_group ? " has-exact-dup" : "";
      var headwordDupClass = (!e.exact_dup_group && e.headword_group) ? " has-headword-dup" : "";
      html.push(
        '<div class="word-item' + activeClass + exactDupClass + headwordDupClass + '" data-id="' + e.id + '" role="button" tabindex="0">' +
          '<span class="w-head">' + escapeHtml(e.headword) + "</span>" +
          (e.part_of_speech ? '<span class="w-pos">' + escapeHtml(posLabel(e)) + "</span>" : "") +
          (isDeleted(e.id) ? '<span class="w-deleted">deleted</span>' : "") +
          (edits[e.id] ? '<span class="w-edited">edited</span>' : "") +
          (e.exact_dup_group ? '<span class="w-exact-dup" title="Byte-identical headword + gloss to ' + e.exact_dup_siblings.length + ' other entr' + (e.exact_dup_siblings.length === 1 ? "y" : "ies") + ' — a true duplicate, not a homograph">duplicate</span>' : "") +
          (!e.exact_dup_group && e.headword_group ? '<span class="w-headword-dup" title="Same headword as ' + e.headword_siblings.length + ' other entr' + (e.headword_siblings.length === 1 ? "y" : "ies") + ' (gloss differs) — could be a genuine extra sense or a leftover duplicate, needs a look">same headword</span>' : "") +
          (!e.exact_dup_group && !e.headword_group && e.dup_group ? '<span class="w-dup" title="Shares a spelling with ' + e.dup_siblings.length + ' other entr' + (e.dup_siblings.length === 1 ? "y" : "ies") + '">dup</span>' : "") +
          (e.project_review_status === "reviewed" ? '<span class="w-reviewed" title="Reviewed">&#10003;</span>' : "") +
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
    if (isDeleted(entry.id)) {
      panelEl.innerHTML =
        '<div class="entry-panel-empty">' +
        '<p>"' + escapeHtml(entry.headword) + '" is marked for local deletion.</p>' +
        '<button type="button" class="btn btn-primary" data-action="restore" data-id="' + entry.id + '">Restore</button>' +
        "</div>";
      return;
    }

    var parts = [];
    parts.push('<article class="dict-entry">');

    parts.push('<div class="dict-entry-head">');
    parts.push('<span class="dict-headword">' + escapeHtml(entry.headword) + "</span>");
    if (entry.part_of_speech) {
      parts.push('<span class="pos-abbr">' + escapeHtml(posLabel(entry)) + "</span>");
    }
    if (entry.tone_marked) parts.push('<span class="tag">tone</span>');
    if (entry.project_review_status === "reviewed") parts.push('<span class="tag tag-reviewed">reviewed</span>');
    if (edits[entry.id]) {
      parts.push('<span class="edited-badge">edited</span>');
      parts.push('<button type="button" class="btn btn-ghost" data-action="revert" data-id="' + entry.id + '">Revert</button>');
    }
    if (entry.headword_original && entry.headword_original !== entry.headword) {
      parts.push('<span class="dict-original">orig. ' + escapeHtml(entry.headword_original) + "</span>");
    }
    parts.push(
      '<button type="button" class="btn" data-action="toggle-review" data-id="' + entry.id + '">' +
        (entry.project_review_status === "reviewed" ? "Mark unreviewed" : "Mark reviewed") +
        "</button>"
    );
    parts.push(
      '<button type="button" class="btn edit-toggle" data-action="edit" data-id="' + entry.id + '">Edit</button>'
    );
    parts.push(
      '<button type="button" class="btn btn-danger" data-action="delete" data-id="' + entry.id + '">Delete</button>'
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

    if (entry.exact_dup_group && entry.exact_dup_siblings.length) {
      var exactLinks = entry.exact_dup_siblings
        .map(function (sid) {
          var sib = BY_ID[sid];
          if (!sib) return "";
          return '<button type="button" class="dup-link dup-link-exact" data-action="goto" data-id="' + sid + '">' + escapeHtml(sib.headword) + " — " + escapeHtml(sib.gloss_es || sib.gloss_en || "") + " (#" + formatIndex(sib.id) + ")</button>";
        })
        .filter(Boolean)
        .join("");
      parts.push(
        '<div class="exact-dup-callout">' +
          '<span class="exact-dup-title">Exact duplicate</span>' +
          '<span class="dup-explain">byte-identical headword and gloss to:</span>' +
          exactLinks +
        "</div>"
      );
    } else if (entry.headword_group && entry.headword_siblings.length) {
      var headwordLinks = entry.headword_siblings
        .map(function (sid) {
          var sib = BY_ID[sid];
          if (!sib) return "";
          return '<button type="button" class="dup-link dup-link-headword" data-action="goto" data-id="' + sid + '">' + escapeHtml(sib.headword) + " — " + escapeHtml(sib.gloss_es || sib.gloss_en || "") + " (#" + formatIndex(sib.id) + ")</button>";
        })
        .filter(Boolean)
        .join("");
      parts.push(
        '<div class="headword-dup-callout">' +
          '<span class="headword-dup-title">Same headword</span>' +
          '<span class="dup-explain">gloss differs from the exact-duplicate check, so this could be a genuine extra sense or a leftover duplicate — compare and decide:</span>' +
          headwordLinks +
        "</div>"
      );
    } else if (entry.dup_group && entry.dup_siblings.length) {
      var siblingLinks = entry.dup_siblings
        .map(function (sid) {
          var sib = BY_ID[sid];
          if (!sib) return "";
          return '<button type="button" class="dup-link" data-action="goto" data-id="' + sid + '">' + escapeHtml(sib.headword) + " — " + escapeHtml(sib.gloss_es || sib.gloss_en || "") + "</button>";
        })
        .filter(Boolean)
        .join("");
      parts.push(
        relatedRow(
          "possible duplicate",
          '<span class="dup-explain">shares a spelling (once n\'/ñ is treated the same way) with:</span>' + siblingLinks
        )
      );
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
    refreshChangesBar();
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
        refreshChangesBar();
        applyFilters();
        renderDetail(effectiveEntry(id));
      }
    } else if (action === "delete") {
      var headword = effectiveEntry(id).headword;
      if (confirm('Mark "' + headword + '" for deletion?\n\nThis only affects your own browser — nothing is removed from the actual database until you export your changes and apply them. Find it again later under review status "Deleted (locally)" to restore it.')) {
        deletions[id] = { deleted_at: new Date().toISOString() };
        persistDeletions();
        refreshChangesBar();
        applyFilters();
        renderDetail(effectiveEntry(id));
      }
    } else if (action === "restore") {
      delete deletions[id];
      persistDeletions();
      refreshChangesBar();
      applyFilters();
      renderDetail(effectiveEntry(id));
    } else if (action === "toggle-review") {
      var next = effectiveEntry(id).project_review_status === "reviewed" ? "unreviewed" : "reviewed";
      reviews[id] = { status: next, reviewed_at: new Date().toISOString() };
      persistReviews();
      refreshChangesBar();
      applyFilters();
      renderDetail(effectiveEntry(id));
    } else if (action === "goto") {
      selectEntry(id);
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
  statusSelect.addEventListener("change", function () {
    state.status = statusSelect.value;
    applyFilters();
  });
  dupCheckbox.addEventListener("change", function () {
    state.dupOnly = dupCheckbox.checked;
    applyFilters();
  });
  headwordDupCheckbox.addEventListener("change", function () {
    state.headwordDupOnly = headwordDupCheckbox.checked;
    applyFilters();
  });

  applyFilters();
  refreshChangesBar();

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
