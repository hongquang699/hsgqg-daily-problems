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
  const storageKey = 'hsgqg-cpp-editor-v1';
  let fileName = 'main.cpp';

  const keywords = new Set('alignas alignof asm auto break case catch class const constexpr continue decltype default delete do else enum explicit export extern false for friend goto if inline mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return sizeof static static_assert struct switch template this throw true try typedef typeid typename union using virtual volatile while'.split(' '));
  const types = new Set('bool char char16_t char32_t double float int long short signed unsigned void wchar_t size_t string vector map unordered_map set unordered_set pair queue stack deque priority_queue cin cout cerr endl std'.split(' '));
  const escapeHTML = value => value.replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const tokenPattern = /(^[ \t]*#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_][A-Za-z_0-9]*\b|\b\d+(?:\.\d+)?\b)/gm;

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

  input.addEventListener('input', render);
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('click', updatePosition);
  input.addEventListener('keyup', updatePosition);
  input.addEventListener('select', updatePosition);
  input.addEventListener('keydown', event => {
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
