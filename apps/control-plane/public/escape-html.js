const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

// Escapes server- or user-provided values before interpolating them into an
// innerHTML template literal. Returns '' for null/undefined so callers can keep
// using the value directly in a template without leaking the literal "undefined".
export const escapeHtml = (value) => {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
};
