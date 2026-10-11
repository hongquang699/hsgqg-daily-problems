(() => {
  'use strict';
  const input = document.getElementById('code');
  const highlighted = document.getElementById('codeHighlight');
  const lines = document.getElementById('lineNumbers');
  const position = document.getElementById('cursorPosition');
  const count = document.getElementById('characterCount');
  const fileNameLabel = document.getElementById('fileName');
  const fileInput = document.getElementById('file');
  const saveButton = document.getElementById('downloadCode');
  const suggestButton = document.getElementById('showSuggestions');
  const suggestionBox = document.getElementById('codeSuggestions');
  const storageKey = 'hsgqg-cpp-editor-v1';
  let fileName = 'main.cpp';
  let suggestions = [], selectedSuggestion = 0, suggestionPrefix = '', manualSuggestions = false;

  const keywords = new Set('alignas alignof asm auto break case catch class const constexpr continue decltype default delete do else enum explicit export extern false for friend goto if inline mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return sizeof static static_assert struct switch template this throw true try typedef typeid typename union using virtual volatile while'.split(' '));
  const types = new Set('bool char char16_t char32_t double float int long short signed unsigned void wchar_t size_t string vector map unordered_map set unordered_set pair queue stack deque priority_queue cin cout cerr endl std'.split(' '));
  const escapeHTML = value => value.replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const tokenPattern = /(^[ \t]*#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_][A-Za-z_0-9]*\b|\b\d+(?:\.\d+)?\b)/gm;
  const snippets = [
    {label:'for', kind:'Mẫu', detail:'vòng lặp', insert:'for (int i = 0; i < |; ++i) {\n    \n}'},
    {label:'fori', kind:'Mẫu', detail:'lặp đến n', insert:'for (int i = 0; i < |; ++i) {\n    \n}'},
    {label:'if', kind:'Mẫu', detail:'điều kiện', insert:'if (|) {\n    \n}'},
    {label:'while', kind:'Mẫu', detail:'vòng lặp', insert:'while (|) {\n    \n}'},
    {label:'cout', kind:'Mẫu', detail:'in kết quả', insert:"cout << | << '\\n';"},
    {label:'cin', kind:'Mẫu', detail:'đọc dữ liệu', insert:'cin >> |;'},
    {label:'vector', kind:'Mẫu', detail:'mảng động', insert:'vector<|>'},
    {label:'sort', kind:'Mẫu', detail:'sắp xếp', insert:'sort(a.begin(), a.end());|'},
    {label:'lower_bound', kind:'Mẫu', detail:'tìm kiếm nhị phân', insert:'lower_bound(a.begin(), a.end(), |)'},
    {label:'upper_bound', kind:'Mẫu', detail:'tìm kiếm nhị phân', insert:'upper_bound(a.begin(), a.end(), |)'}
  ];
  const standardNames = 'push_back emplace_back begin end size empty clear find count insert erase resize reserve front back min max abs gcd lcm swap reverse accumulate binary_search make_pair to_string getline'.split(' ');
  const fixedSuggestions = [
    ...[...keywords].map(label => ({label, kind:'Từ khóa', detail:'C++', insert:label})),
    ...[...types].map(label => ({label, kind:'Kiểu', detail:'C++/STL', insert:label})),
    ...standardNames.map(label => ({label, kind:'Hàm', detail:'STL', insert:label}))
  ];

  function colorize(source) {
    let html = '', previous = 0, match;
    tokenPattern.lastIndex = 0;
    while ((match = tokenPattern.exec(source)) !== null) {
      html += escapeHTML(source.slice(previous, match.index));
      const token = match[0];
      let kind = '';
      if (/^\s*#/.test(token)) kind = 'preprocessor';
      else if (token.startsWith('//') || token.startsWith('/*')) kind = 'comment';
      else if (token[0] === '"' || token[0] === "'") kind = 'string';
      else if (/^\d/.test(token)) kind = 'number';
      else if (keywords.has(token)) kind = 'keyword';
      else if (types.has(token)) kind = 'type';
      html += kind ? '<span class="tok-' + kind + '">' + escapeHTML(token) + '</span>' : escapeHTML(token);
      previous = tokenPattern.lastIndex;
    }
    html += escapeHTML(source.slice(previous));
    return html + (source.endsWith('\n') ? ' ' : '');
  }

  function updatePosition() {
    const before = input.value.slice(0, input.selectionStart);
    const row = before.split('\n');
    position.textContent = 'Ln ' + row.length + ', Col ' + (row[row.length - 1].length + 1);
  }

  function syncScroll() {
    highlighted.scrollTop = input.scrollTop;
    highlighted.scrollLeft = input.scrollLeft;
    lines.scrollTop = input.scrollTop;
  }

  function render() {
    const source = input.value;
    highlighted.innerHTML = colorize(source);
    const total = source.split('\n').length;
    lines.textContent = Array.from({length: total}, (_, index) => index + 1).join('\n');
    count.textContent = source.length + ' ký tự';
    updatePosition();
    syncScroll();
    try { localStorage.setItem(storageKey, source); } catch {}
  }

  function replaceSelection(text, cursorOffset = text.length) {
    const start = input.selectionStart, end = input.selectionEnd;
    input.setRangeText(text, start, end, 'end');
    const cursor = start + cursorOffset;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }

  function closeSuggestions() {
    suggestionBox.hidden = true;
    suggestionBox.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    suggestions = [];
    manualSuggestions = false;
  }

  function positionSuggestions() {
    if (suggestionBox.hidden) return;
    const style = getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight);
    const charWidth = parseFloat(style.fontSize) * 0.602;
    const before = input.value.slice(0, input.selectionStart).split('\n');
    const row = before.length - 1, column = before[row].length;
    const caretX = parseFloat(style.paddingLeft) + column * charWidth - input.scrollLeft;
    const caretY = parseFloat(style.paddingTop) + row * lineHeight - input.scrollTop;
    const surface = input.parentElement;
    const left = Math.max(4, Math.min(caretX, surface.clientWidth - suggestionBox.offsetWidth - 4));
    let top = caretY + lineHeight + 4;
    if (top + suggestionBox.offsetHeight > surface.clientHeight) top = caretY - suggestionBox.offsetHeight - 4;
    suggestionBox.style.left = Math.round(left) + 'px';
    suggestionBox.style.top = Math.round(Math.max(4, top)) + 'px';
  }

  function markSelectedSuggestion() {
    for (const [index, option] of [...suggestionBox.children].entries()) {
      option.setAttribute('aria-selected', String(index === selectedSuggestion));
    }
    const active = suggestionBox.children[selectedSuggestion];
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({block:'nearest'});
    }
  }

  function acceptSuggestion(index = selectedSuggestion) {
    const item = suggestions[index];
    if (!item) return;
    const end = input.selectionStart;
    const start = end - suggestionPrefix.length;
    const marker = item.insert.indexOf('|');
    const lineStart = input.value.lastIndexOf('\n', start - 1) + 1;
    const baseIndent = (input.value.slice(lineStart, start).match(/^\s*/) || [''])[0];
    const withIndent = text => text.replace(/\n/g, '\n' + baseIndent);
    const replacement = withIndent(marker < 0 ? item.insert : item.insert.slice(0, marker) + item.insert.slice(marker + 1));
    input.setRangeText(replacement, start, end, 'end');
    const cursor = start + (marker < 0 ? replacement.length : withIndent(item.insert.slice(0, marker)).length);
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event('input', {bubbles:true}));
    closeSuggestions();
    input.focus();
  }

  function updateSuggestions(force = false) {
    if (force) manualSuggestions = true;
    if (input.selectionStart !== input.selectionEnd) { closeSuggestions(); return; }
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/[A-Za-z_][A-Za-z_0-9]*$/);
    const prefix = match ? match[0] : '';
    const line = before.slice(before.lastIndexOf('\n') + 1);
    if (!manualSuggestions && prefix.length < 2 && !before.endsWith('::')) { closeSuggestions(); return; }
    if (line.trimStart().startsWith('//')) { closeSuggestions(); return; }

    const sourceWithoutLiterals = input.value.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
    const identifiers = [...new Set(sourceWithoutLiterals.match(/\b[A-Za-z_][A-Za-z_0-9]{1,}\b/g) || [])]
      .filter(label => label !== prefix && !keywords.has(label) && !types.has(label))
      .map(label => ({label, kind:'Trong file', detail:'đã dùng', insert:label}));
    const seen = new Set();
    suggestions = [...snippets, ...identifiers, ...fixedSuggestions].filter(item => {
      if (seen.has(item.label)) return false;
      seen.add(item.label);
      return !prefix || item.label.startsWith(prefix);
    }).slice(0, 8);
    if (!suggestions.length) { closeSuggestions(); return; }
    suggestionPrefix = prefix;
    selectedSuggestion = 0;
    suggestionBox.replaceChildren();
    for (const [index, item] of suggestions.entries()) {
      const option = document.createElement('div');
      option.className = 'suggestion-option';
      option.id = 'code-suggestion-' + index;
      option.setAttribute('role', 'option');
      const kind = document.createElement('span');
      kind.className = 'suggestion-kind';
      kind.textContent = item.kind;
      const label = document.createElement('span');
      label.className = 'suggestion-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'suggestion-detail';
      detail.textContent = item.detail;
      option.append(kind, label, detail);
      option.addEventListener('pointerdown', event => {event.preventDefault(); acceptSuggestion(index);});
      suggestionBox.append(option);
    }
    suggestionBox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    markSelectedSuggestion();
    positionSuggestions();
  }

  input.addEventListener('input', () => {render(); updateSuggestions();});
  input.addEventListener('scroll', () => {syncScroll(); positionSuggestions();});
  input.addEventListener('click', () => {updatePosition(); closeSuggestions();});
  input.addEventListener('keyup', updatePosition);
  input.addEventListener('select', updatePosition);
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.code-surface') && event.target !== suggestButton) closeSuggestions();
  });
  suggestButton.addEventListener('click', () => {input.focus(); updateSuggestions(true);});
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && (event.code === 'Space' || event.key === ' ')) {
      event.preventDefault();
      updateSuggestions(true);
      return;
    }
    if (!suggestionBox.hidden && ['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault();
      selectedSuggestion = (selectedSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      markSelectedSuggestion();
      return;
    }
    if (!suggestionBox.hidden && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      acceptSuggestion();
      return;
    }
    if (event.key === 'Escape' && !suggestionBox.hidden) {
      event.preventDefault();
      closeSuggestions();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveButton.click();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('submit').click();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      closeSuggestions();
      if (event.shiftKey) {
        const start = input.value.lastIndexOf('\n', input.selectionStart - 1) + 1;
        const spaces = Math.min(4, (input.value.slice(start, input.selectionStart).match(/^ */) || [''])[0].length);
        if (spaces) {
          input.setRangeText('', start, start + spaces, 'preserve');
          input.dispatchEvent(new Event('input', {bubbles:true}));
        }
      } else replaceSelection('    ');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && input.selectionStart === input.selectionEnd) {
      event.preventDefault();
      const start = input.value.lastIndexOf('\n', input.selectionStart - 1) + 1;
      const prefix = input.value.slice(start, input.selectionStart);
      const indent = (prefix.match(/^\s*/) || [''])[0] + (prefix.trimEnd().endsWith('{') ? '    ' : '');
      replaceSelection('\n' + indent);
      return;
    }
    const pairs = {'(' : ')', '[' : ']', '{' : '}', '"' : '"', "'" : "'"};
    if (!event.ctrlKey && !event.metaKey && !event.altKey && input.selectionStart === input.selectionEnd && pairs[event.key]) {
      event.preventDefault();
      replaceSelection(event.key + pairs[event.key], 1);
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 100000) { alert('Tệp quá 100 KB'); fileInput.value = ''; return; }
    fileName = file.name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'main.cpp';
    fileNameLabel.textContent = fileName;
    input.value = await file.text();
    render();
    closeSuggestions();
    input.focus();
    fileInput.value = '';
  });

  saveButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([input.value], {type:'text/x-c++src;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) input.value = saved;
  } catch {}
  render();
})();
