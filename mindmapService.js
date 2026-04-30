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
   * parses an HTML string from the editor and extracts header elements.
   * @param {string} htmlContent - raw HTML from TinyMCE
   * @returns {NodeList} - all h1–h6 elements found in the content
   */
  function extractHeaders(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    return doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  }

  /**
   * builds a nested hierarchy tree from a list of header elements.
   * this uses header level (h1=1, h2=2, .et cetara.) to determine parent-child relationship
   *
   * @param {NodeList|Array} headers - header elements
   * @returns {Object|null} - root node of tree, null if no headers
   *
   * the node shape: { name: string, level: number, children: Node[] }
   */
  function buildHierarchy(headers) {
    if (!headers || headers.length === 0) return null;

    const stack = [];
    let root = null;

    headers.forEach(h => {
      const level = parseInt(h.tagName[1]);
      const text = h.textContent.trim();

      // skippign empty headers
      if (!text) return;

      const node = { name: text, level, children: [] };

      if (!root) {
        root = node;
        stack.push({ node, level });
        return;
      }

      // pop the stack until we find a node at a higher (lower number) level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        // new root level sib
        root.children.push(node);
      } else {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, level });
    });

    return root;
  }

  /**
   * IMPORTANT: take raw HTML, return a mindmap tree.
   * primary ui layer method
   *
   * @param {string} htmlContent - Raw HTML from TinyMCE
   * @returns {Object|null} - Hierarchy tree root node
   */
  function buildMindmapFromContent(htmlContent) {
    const headers = extractHeaders(htmlContent);
    return buildHierarchy(headers);
  }

  /**
   * makes the mindmap tree into a plain JSON-safe object
   * used by firebaseService to persist the mindmap
   *
   * @param {Object} tree - mindmap tree root nod e
   * @returns {Object} - JSON-safe
   */
  function serializeTree(tree) {
    if (!tree) return null;
    return JSON.parse(JSON.stringify(tree)); // deep clone, strips any DOM refs
  }

  /**
   * restores a mindmap tree from a saved snapshot
   * 
   * 
   *
   * @param {Object} snapshot - saved tree object
   * @returns {Object|null} - restored tree, or null if invalid
   */
  function deserializeTree(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (typeof snapshot.name !== 'string') return null;
    return snapshot;
  }

  /**
   * counts total nodes in the tree can be useful for stats/validation)
   * @param {Object} node
   * @returns {number}
   */
  function countNodes(node) {
    if (!node) return 0;
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
  }

  // public API
  return {
    buildMindmapFromContent,
    buildHierarchy,
    extractHeaders,
    serializeTree,
    deserializeTree,
    countNodes,
  };

})();
