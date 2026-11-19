/**
 * Minimal synchronous React stand-in for rendering the local-model-manager client's panel
 * components in tests. It follows the React execution model closely enough to
 * exercise the real code paths: createElement returns a lazy element
 * descriptor; rendering executes function components (with per-component
 * persistent hook state, effect scheduling, and hook-order enforcement that
 * throws on a hook-count change between renders) and class components;
 * `getDerivedStateFromError` boundaries catch errors thrown while executing
 * their child subtree — so an unexpected render exception yields the visible
 * fallback, exactly as in the real DOM.
 */

/**
 * Recursively flatten render children, dropping React's "no child" values but
 * keeping falsy meaningful values such as 0.
 * @param {unknown[]} children
 * @returns {unknown[]}
 */
const flattenChildren = (children) => children.flat(20)
  .filter((child) => child !== null && child !== undefined && child !== true && child !== false)

/**
 * Build the harness. Components are keyed by function identity; hook state
 * persists across `renderOne` calls for the same component function.
 * @returns {{React: object, renderOne: Function, flushEffects: Function, textOf: Function}}
 */
export function createRenderHarness() {
  /** @type {Map<Function, {states: unknown[], cursor: number, counts: number[]}>} */
  const instances = new Map()
  /** @type {Function[]} effects scheduled during the most recent render */
  let effects = []
  /** @type {{cursor: number, states: unknown[]}|undefined} the instance whose hooks are running */
  let current = undefined

  const instanceFor = (type) => {
    let instance = instances.get(type)
    if (instance === undefined) {
      instance = { states: [], cursor: 0, counts: [] }
      instances.set(type, instance)
    }
    return instance
  }

  const React = {
    /** Base class so `PanelErrorBoundary extends React.Component` resolves. */
    Component: class Component {
      constructor(props) {
        this.props = props
        this.state = {}
      }

      /** @param {object} partial merges into state, React-`setState` style. */
      setState(partial) { this.state = { ...this.state, ...partial } }
    },

    /** @returns {object} a lazy `{kind, props, children}` element descriptor. */
    createElement(type, props, ...children) {
      const flat = flattenChildren(children)
      // React merges children into props (boundaries read props.children).
      const merged = { ...props }
      if (flat.length === 1) merged.children = flat[0]
      else if (flat.length > 1) merged.children = flat
      return { kind: type, props: merged, children: flat }
    },

    useState(initial) {
      const instance = current
      const index = instance.cursor++
      if (instance.states.length <= index) {
        instance.states[index] = typeof initial === 'function' ? initial() : initial
      }
      const set = (next) => {
        instance.states[index] = typeof next === 'function' ? next(instance.states[index]) : next
      }
      return [instance.states[index], set]
    },

    useCallback(fn) {
      current.cursor++
      return fn
    },

    useEffect(fn) {
      current.cursor++
      effects.push(fn)
      return undefined
    },
  }

  /**
   * Execute one function-component render, enforcing the stable hook order.
   * @param {Function} type the component function.
   * @param {object} props its props.
   * @returns {object} the element descriptor it returns.
   */
  const runFunctionComponent = (type, props) => {
    const instance = instanceFor(type)
    const previous = instance.counts.length > 0 ? instance.counts[instance.counts.length - 1] : undefined
    instance.cursor = 0
    current = instance
    try {
      const descriptor = type(props)
      if (previous !== undefined && previous !== instance.cursor) {
        throw new Error('Rendered more hooks than during the previous render '
          + `(${previous} → ${instance.cursor})`)
      }
      instance.counts.push(instance.cursor)
      return descriptor
    } finally {
      current = undefined
    }
  }

  /**
   * Execute one element: host tags become rendered nodes; function components
   * run through the hook runtime; class components render, with a registered
   * boundary absorbing any error from their own subtree.
   * @param {unknown} node descriptor, string, number, or array.
   * @returns {unknown} the rendered node or array of rendered nodes.
   */
  const execute = (node) => {
    if (node === null || node === undefined) return null
    if (typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((child) => execute(child)).filter((child) => child !== null)
    const { kind, props, children } = node
    if (typeof kind !== 'function') {
      return { type: kind, props, children: executeAll(children) }
    }
    if (typeof kind.prototype?.render === 'function') {
      const instance = new kind(props)
      try {
        return execute(instance.render())
      } catch (error) {
        if (typeof kind.getDerivedStateFromError !== 'function') throw error
        console.error('BOUNDARY:', error && error.stack ? error.stack : error)
        console.error('BOUNDARY:', error && error.stack ? error.stack : String(error))
        instance.setState(kind.getDerivedStateFromError(error))
        return execute(instance.render())
      }
    }
    return execute(runFunctionComponent(kind, props))
  }

  /** @param {unknown[]} nodes executes a child list into a flat rendered list. */
  const executeAll = (nodes) => (Array.isArray(nodes) ? nodes : [nodes]).flatMap((node) => {
    const executed = execute(node)
    return Array.isArray(executed) ? executed : [executed]
  })

  /**
   * Render one top component eagerly; returns its executed element tree.
   * @param {Function} Component top component.
   * @param {object} props its props.
   * @returns {object} rendered tree.
   */
  const renderOne = (Component, props) => execute(React.createElement(Component, props))

  /**
   * Run the effects scheduled by the last render and settle two turns of
   * promise chains (load resolutions reach their setState callbacks).
   * @returns {Promise<void>}
   */
  const flushEffects = async () => {
    const pending = effects
    effects = []
    for (const effect of pending) {
      const result = effect({})
      if (result !== null && typeof result === 'object' && typeof result.then === 'function') await result
    }
    // Generous microtask budget: injected panel calls chain several awaits.
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }

  /**
   * Concatenate the plain strings of a rendered tree, for text assertions.
   * @param {unknown} node rendered node or string.
   * @returns {string}
   */
  const textOf = (node) => {
    if (node === null || node === undefined) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (typeof node !== 'object') return ''
    if (Array.isArray(node)) return node.map((child) => textOf(child)).join('')
    const children = Array.isArray(node.children) ? node.children : [node.children]
    return children.map((child) => textOf(child)).join('')
  }

  return { React, renderOne, flushEffects, textOf }
}