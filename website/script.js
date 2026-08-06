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

  var state = { query: "", pos: "", morph: "", domain: "", selectedId: null };
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

  function posLabel(e) {
    if (!e.part_of_speech) return "";
    var abbr = POS_ABBR[e.part_of_speech] || e.part_of_speech;
    return e.part_of_speech_subtype ? abbr + " (" + e.part_of_speech_subtype + ")" : abbr;
  }

  function applyFilters() {
    var q = normalize(state.query);
    filtered = ALL.filter(function (e) {
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
    filtered.forEach(function (e) {
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
    if (entry.headword_original && entry.headword_original !== entry.headword) {
      parts.push('<span class="dict-original">orig. ' + escapeHtml(entry.headword_original) + "</span>");
    }
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

    parts.push("</article>");
    panelEl.innerHTML = parts.join("");
  }

  function selectEntry(id, opts) {
    id = Number(id);
    var entry = BY_ID[id];
    if (!entry) return;

    var prevActive = listEl.querySelector(".word-item.active");
    if (prevActive) prevActive.classList.remove("active");
    state.selectedId = id;
    var nextActive = listEl.querySelector('.word-item[data-id="' + id + '"]');
    if (nextActive) {
      nextActive.classList.add("active");
      if (!opts || opts.scroll !== false) {
        nextActive.scrollIntoView({ block: "nearest" });
      }
    }

    renderDetail(entry);
    history.replaceState(null, "", "#e-" + id);
  }

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
