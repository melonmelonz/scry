// Tiny DOM builder helper. Builds elements via createElement + textContent so
// user input is never interpolated into innerHTML.
// Usage:
//   el('div', { class: 'foo', dataset: { id: 1 }, onclick: fn }, [
//     el('span', { text: 'hello' }),
//     'static text node'
//   ])

export function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// Replace the children of `host` with `nodes`. Accepts an array.
export function replaceChildren(host, nodes) {
  host.replaceChildren(...nodes.filter(n => n != null));
}
