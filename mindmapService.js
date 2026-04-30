/**
 * mindmapService.js
 * APPLICATION LAYER — Business Logic
 *
 * Responsibilities:
 *  - Parse raw HTML content from the editor into header elements
 *  - Build a hierarchy tree from those headers (h1–h6 nesting)
 *  - Produce a serializable snapshot of the mindmap (for persistence)
 *  - Restore a mindmap tree from a saved snapshot
 *
 * This module has NO knowledge of the DOM outside of parsing,
 * NO knowledge of Firebase, and NO knowledge of D3 or TinyMCE.
 * It only transforms data.
 */

const MindmapService = (() => {

  /**
   * Parses an HTML string from the editor and extracts header elements.
   * @param {string} htmlContent - Raw HTML from TinyMCE
   * @returns {NodeList} - All h1–h6 elements found in the content
   */
  function extractHeaders(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    return doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  }

  /**
   * Builds a nested hierarchy tree from a list of header elements.
   * Uses header level (h1=1, h2=2, ...) to determine parent-child relationships.
   *
   * @param {NodeList|Array} headers - Header DOM elements
   * @returns {Object|null} - Root node of the tree, or null if no headers
   *
   * Node shape: { name: string, level: number, children: Node[] }
   */
  function buildHierarchy(headers) {
    if (!headers || headers.length === 0) return null;

    const stack = [];
    let root = null;

    headers.forEach(h => {
      const level = parseInt(h.tagName[1]);
      const text = h.textContent.trim();

      // Skip empty headers
      if (!text) return;

      const node = { name: text, level, children: [] };

      if (!root) {
        root = node;
        stack.push({ node, level });
        return;
      }

      // Pop stack until we find a node at a higher (lower number) level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // New root-level sibling — treat as child of a virtual root
        // This handles cases where content starts at h2, etc.
        root.children.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, level });
    });

    return root;
  }

  /**
   * Full pipeline: take raw HTML, return a mindmap tree.
   * This is the primary method the UI layer calls.
   *
   * @param {string} htmlContent - Raw HTML from TinyMCE
   * @returns {Object|null} - Hierarchy tree root node
   */
  function buildMindmapFromContent(htmlContent) {
    const headers = extractHeaders(htmlContent);
    return buildHierarchy(headers);
  }

  /**
   * Serializes the mindmap tree into a plain JSON-safe object.
   * Used by firebaseService to persist the mindmap.
   *
   * @param {Object} tree - Mindmap tree root node
   * @returns {Object} - JSON-safe snapshot
   */
  function serializeTree(tree) {
    if (!tree) return null;
    return JSON.parse(JSON.stringify(tree)); // deep clone, strips any DOM refs
  }

  /**
   * Restores a mindmap tree from a saved snapshot.
   * Since we store plain objects, this is an identity operation,
   * but it validates the shape.
   *
   * @param {Object} snapshot - Saved tree object
   * @returns {Object|null} - Restored tree, or null if invalid
   */
  function deserializeTree(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (typeof snapshot.name !== 'string') return null;
    return snapshot;
  }

  /**
   * Counts total nodes in the tree (useful for stats/validation).
   * @param {Object} node
   * @returns {number}
   */
  function countNodes(node) {
    if (!node) return 0;
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
  }

  // Public API
  return {
    buildMindmapFromContent,
    buildHierarchy,
    extractHeaders,
    serializeTree,
    deserializeTree,
    countNodes,
  };

})();
