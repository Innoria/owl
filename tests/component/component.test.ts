import { Component, Env } from "../../src/component/component";
import { QWeb } from "../../src/qweb/qweb";
import { xml } from "../../src/tags";
import { useState, useRef } from "../../src/hooks";
import { EventBus } from "../../src/core/event_bus";
import {
  makeDeferred,
  makeTestFixture,
  makeTestEnv,
  nextMicroTick,
  nextTick,
  normalize,
  editInput
} from "../helpers";

//------------------------------------------------------------------------------
// Setup and helpers
//------------------------------------------------------------------------------

// We create before each test:
// - fixture: a div, appended to the DOM, intended to be the target of dom
//   manipulations.  Note that it is removed after each test.
// - env: a WEnv, necessary to create new components

let fixture: HTMLElement;
let env: Env;

beforeEach(() => {
  fixture = makeTestFixture();
  env = makeTestEnv();
  env.qweb.addTemplate("WidgetA", `<div>Hello<t t-component="b"/></div>`);
  env.qweb.addTemplate("WidgetB", `<div>world</div>`);
  Component.env = env;
});

afterEach(() => {
  fixture.remove();
});

function children(w: Component<any, any>): Component<any, any>[] {
  const childrenMap = w.__owl__.children;
  return Object.keys(childrenMap).map(id => childrenMap[id]);
}

// Test components

class WidgetB extends Component<any, any> {}

class WidgetA extends Component<any, any> {
  static components = { b: WidgetB };
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("basic widget properties", () => {
  test("props is set on root components", async () => {
    const widget = new Component<any, any>(null, {});
    expect(widget.props).toEqual({});
  });

  test("has no el after creation", async () => {
    const widget = new Component<any, any>();
    expect(widget.el).toBe(null);
  });

  test("can be mounted", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`<div>content</div>`;
    }
    const widget = new SomeWidget();
    widget.mount(fixture);
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>content</div>");
  });

  test("can be mounted on a documentFragment", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`<div>content</div>`;
    }
    const widget = new SomeWidget();
    await widget.mount(document.createDocumentFragment());
    expect(fixture.innerHTML).toBe("");
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>content</div>");
  });

  test("display a nice message if mounted on a non existing node", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`<div>content</div>`;
    }
    const widget = new SomeWidget();
    let error;
    try {
      await widget.mount(null as any);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe(
      "Component 'SomeWidget' cannot be mounted: the target is not a valid DOM node.\nMaybe the DOM is not ready yet? (in that case, you can use owl.utils.whenReady)"
    );
  });

  test("display an error message if result of rendering is empty", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`<t/>`;
    }
    const widget = new SomeWidget();
    let error;
    try {
      await widget.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Rendering 'SomeWidget' did not return anything");
  });

  test("crashes if it cannot find a template", async () => {
    expect.assertions(1);
    class SomeWidget extends Component<any, any> {}
    try {
      new SomeWidget();
    } catch (e) {
      expect(e.message).toBe('Could not find template for component "SomeWidget"');
    }
  });

  test("can be clicked on and updated", async () => {
    class Counter extends Component<any, any> {
      static template = xml`
      <div><t t-esc="state.counter"/><button t-on-click="state.counter++">Inc</button></div>`;
      state = useState({
        counter: 0
      });
    }

    const counter = new Counter();
    counter.mount(fixture);
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>0<button>Inc</button></div>");
    const button = (<HTMLElement>counter.el).getElementsByTagName("button")[0];
    button.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>1<button>Inc</button></div>");
  });

  test("can handle empty props", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child val=""/></div>`;
      static components = { Child };
    }

    const parent = new Parent();
    await parent.mount(fixture);
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
    expect(fixture.innerHTML).toBe("<div><span></span></div>");
  });

  test("cannot be clicked on and updated if not in DOM", async () => {
    class Counter extends Component<any, any> {
      static template = xml`
      <div><t t-esc="state.counter"/><button t-on-click="state.counter++">Inc</button></div>`;
      state = useState({
        counter: 0
      });
    }

    const counter = new Counter();
    const target = document.createElement("div");
    await counter.mount(target);
    expect(target.innerHTML).toBe("<div>0<button>Inc</button></div>");
    const button = (<HTMLElement>counter.el).getElementsByTagName("button")[0];
    button.click();
    await nextTick();
    expect(target.innerHTML).toBe("<div>0<button>Inc</button></div>");
    expect(counter.state.counter).toBe(0);
  });

  test("widget style and classname", async () => {
    class StyledWidget extends Component<any, any> {
      static template = xml`
        <div style="font-weight:bold;" class="some-class">world</div>
      `;
    }
    const widget = new StyledWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div style="font-weight:bold;" class="some-class">world</div>`);
  });

  test("changing state before first render does not trigger a render", async () => {
    const steps: string[] = [];
    class TestW extends Component<any, any> {
      static template = xml`<div/>`;
      state = useState({ drinks: 1 });
      async willStart() {
        this.state.drinks++;
      }
      async __render(f) {
        steps.push("__render");
        return super.__render(f);
      }
      mounted() {
        steps.push("mounted");
      }
      patched() {
        steps.push("patched");
      }
    }
    const widget = new TestW();
    await widget.mount(fixture);
    expect(steps).toEqual(["__render", "mounted"]);
  });

  test("changing state before first render does not trigger a render (with parent)", async () => {
    const steps: string[] = [];
    class TestW extends Component<any, any> {
      static template = xml`<span>W</span>`;
      state = useState({ drinks: 1 });
      async willStart() {
        this.state.drinks++;
      }
      async __render(f) {
        steps.push("__render");
        return super.__render(f);
      }
      mounted() {
        steps.push("mounted");
      }
      patched() {
        steps.push("patched");
      }
    }
    class Parent extends Component<any, any> {
      state = useState({ flag: false });
      static components = { TestW };
      static template = xml`<div><TestW t-if="state.flag"/></div>`;
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(fixture.innerHTML).toBe("<div></div>");
    expect(steps).toEqual([]);

    parent.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>W</span></div>");
    expect(steps).toEqual(["__render", "mounted"]);
  });

  test("render method wait until rendering is done", async () => {
    class TestW extends Component<any, any> {
      static template = xml`<div><t t-esc="state.drinks"/></div>`;
      state = { drinks: 1 };
    }
    const widget = new TestW();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>1</div>");

    widget.state.drinks = 2;

    const renderPromise = widget.render();
    expect(fixture.innerHTML).toBe("<div>1</div>");
    await renderPromise;
    expect(fixture.innerHTML).toBe("<div>2</div>");
  });

  test("keeps a reference to env", async () => {
    const widget = new Component<any, any>();
    expect(widget.env).toBe(env);
  });

  test("do not remove previously rendered dom if not necessary", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }
    const widget = new SomeComponent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div></div>`);
    widget.el!.appendChild(document.createElement("span"));
    expect(fixture.innerHTML).toBe(`<div><span></span></div>`);
    widget.render(); // FIXME?
    expect(fixture.innerHTML).toBe(`<div><span></span></div>`);
  });

  test("reconciliation alg is not confused in some specific situation", async () => {
    // in this test, we set t-key to 4 because it was in conflict with the
    // template id corresponding to the first child.
    class Child extends Component<any, any> {
      static template = xml`<span>child</span>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
            <Child />
            <Child t-key="4"/>
        </div>
      `;
      static components = { Child };
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>child</span><span>child</span></div>");
  });

  test("reconciliation alg works for t-foreach in t-foreach", async () => {
    const warn = console.warn;
    console.warn = () => {};
    class Child extends Component<any, any> {
      static template = xml`<div><t t-esc="props.blip"/></div>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
            <t t-foreach="state.s" t-as="section">
                <t t-foreach="section.blips" t-as="blip">
                  <Child blip="blip"/>
                </t>
            </t>
        </div>`;
      static components = { Child };
      state = { s: [{ blips: ["a1", "a2"] }, { blips: ["b1"] }] };
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>a1</div><div>a2</div><div>b1</div></div>");
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
    console.warn = warn;
  });

  test("reconciliation alg works for t-foreach in t-foreach, 2", async () => {
    class Child extends Component<any, any> {
      static template = xml`<div><t t-esc="props.row + '_' + props.col"/></div>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <p t-foreach="state.rows" t-as="row" t-key="row">
            <p t-foreach="state.cols" t-as="col" t-key="col">
                <Child row="row" col="col"/>
              </p>
            </p>
        </div>`;
      static components = { Child };
      state = useState({ rows: [1, 2], cols: ["a", "b"] });
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(
      "<div><p><p><div>1_a</div></p><p><div>1_b</div></p></p><p><p><div>2_a</div></p><p><div>2_b</div></p></p></div>"
    );
    widget.state.rows = [2, 1];
    await nextTick();
    expect(fixture.innerHTML).toBe(
      "<div><p><p><div>2_a</div></p><p><div>2_b</div></p></p><p><p><div>1_a</div></p><p><div>1_b</div></p></p></div>"
    );
  });

  test("same t-keys in two different places", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.blip"/></span>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
            <div><Child t-key="1" blip="'1'"/></div>
            <div><Child t-key="1" blip="'2'"/></div>
        </div>`;
      static components = { Child };
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div><span>1</span></div><div><span>2</span></div></div>");
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
  });

  test("t-key on a component with t-if, and a sibling component", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span>child</span>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <Child t-if="false" t-key="'str'"/>
          <Child/>
        </div>`;
      static components = { Child };
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>child</span></div>");
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
  });
});

describe("mount targets", () => {
  test("can attach a component to an existing node (if same tagname)", async () => {
    class App extends Component<any, any> {
      static template = xml`<div>app</div>`;
    }
    const div = document.createElement("div");
    fixture.appendChild(div);

    const app = new App();
    await app.mount(div, { position: "self" });
    expect(fixture.innerHTML).toBe("<div>app</div>");
  });

  test("cannot attach a component to an existing node (if not same tagname)", async () => {
    class App extends Component<any, any> {
      static template = xml`<span>app</span>`;
    }
    const div = document.createElement("div");
    fixture.appendChild(div);

    const app = new App();
    let error;
    try {
      await app.mount(div, { position: "self" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot attach 'App' to target node (not same tag name)");
  });

  test("can mount a component (with position='first-child')", async () => {
    class App extends Component<any, any> {
      static template = xml`<div>app</div>`;
    }
    const span = document.createElement("span");
    fixture.appendChild(span);

    const app = new App();
    await app.mount(fixture, { position: "first-child" });
    expect(fixture.innerHTML).toBe("<div>app</div><span></span>");
  });

  test("can mount a component (with position='last-child')", async () => {
    class App extends Component<any, any> {
      static template = xml`<div>app</div>`;
    }
    const span = document.createElement("span");
    fixture.appendChild(span);

    const app = new App();
    await app.mount(fixture, { position: "last-child" });
    expect(fixture.innerHTML).toBe("<span></span><div>app</div>");
  });

  test("default mount option is 'last-child'", async () => {
    class App extends Component<any, any> {
      static template = xml`<div>app</div>`;
    }
    const span = document.createElement("span");
    fixture.appendChild(span);

    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<span></span><div>app</div>");
  });
});

describe("lifecycle hooks", () => {
  test("willStart hook is called", async () => {
    let willstart = false;
    class HookWidget extends Component<any, any> {
      static template = xml`<div/>`;
      async willStart() {
        willstart = true;
      }
    }
    const widget = new HookWidget();
    await widget.mount(fixture);
    expect(willstart).toBe(true);
  });

  test("mounted hook is not called if not in DOM", async () => {
    let mounted = false;
    class HookWidget extends Component<any, any> {
      static template = xml`<div/>`;
      async mounted() {
        mounted = true;
      }
    }
    const widget = new HookWidget();
    const target = document.createElement("div");
    await widget.mount(target);
    expect(mounted).toBe(false);
  });

  test("mounted hook is called if mounted in DOM", async () => {
    let mounted = false;
    class HookWidget extends Component<any, any> {
      static template = xml`<div/>`;
      async mounted() {
        mounted = true;
      }
    }
    const widget = new HookWidget();
    await widget.mount(fixture);
    expect(mounted).toBe(true);
  });

  test("willStart hook is called on subwidget", async () => {
    let ok = false;
    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      async willStart() {
        ok = true;
      }
    }

    class ParentWidget extends Component<any, any> {
      static template = xml`<div><t t-component="child"/></div>`;
      static components = { child: ChildWidget };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(ok).toBe(true);
  });

  test("mounted hook is called on subcomponents, in proper order", async () => {
    const steps: any[] = [];

    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      mounted() {
        expect(document.body.contains(this.el)).toBe(true);
        steps.push("child:mounted");
      }
    }

    class ParentWidget extends Component<any, any> {
      static template = xml`<div><ChildWidget /></div>`;
      static components = { ChildWidget };
      mounted() {
        steps.push("parent:mounted");
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual(["child:mounted", "parent:mounted"]);
  });

  test("mounted hook is called on subsubcomponents, in proper order", async () => {
    const steps: any[] = [];

    class ChildChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      mounted() {
        steps.push("childchild:mounted");
      }
      willUnmount() {
        steps.push("childchild:willUnmount");
      }
    }

    class ChildWidget extends Component<any, any> {
      static template = xml`<div><t t-component="childchild"/></div>`;
      static components = { childchild: ChildChildWidget };
      mounted() {
        steps.push("child:mounted");
      }
      willUnmount() {
        steps.push("child:willUnmount");
      }
    }

    class ParentWidget extends Component<any, any> {
      static template = xml`<div><t t-if="state.flag"><t t-component="child"/></t></div>`;
      static components = { child: ChildWidget };
      state = useState({ flag: false });
      mounted() {
        steps.push("parent:mounted");
      }
      willUnmount() {
        steps.push("parent:willUnmount");
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual(["parent:mounted"]);
    widget.state.flag = true;
    await nextTick();
    widget.destroy();
    expect(steps).toEqual([
      "parent:mounted",
      "childchild:mounted",
      "child:mounted",
      "parent:willUnmount",
      "child:willUnmount",
      "childchild:willUnmount"
    ]);
  });

  test("willPatch, patched hook are called on subsubcomponents, in proper order", async () => {
    const steps: any[] = [];

    env.qweb.addTemplate("ChildWidget", `<div><t t-component="childchild" n="props.n"/></div>`);
    env.qweb.addTemplate("ChildChildWidget", `<div><t t-esc="props.n"/></div>`);

    class ChildChildWidget extends Component<any, any> {
      willPatch() {
        steps.push("childchild:willPatch");
      }
      patched() {
        steps.push("childchild:patched");
      }
    }
    class ChildWidget extends Component<any, any> {
      static components = { childchild: ChildChildWidget };
      willPatch() {
        steps.push("child:willPatch");
      }
      patched() {
        steps.push("child:patched");
      }
    }

    env.qweb.addTemplate("ParentWidget", `<div><t t-component="child" n="state.n"/></div>`);
    class ParentWidget extends Component<any, any> {
      static components = { child: ChildWidget };
      state = useState({ n: 1 });
      willPatch() {
        steps.push("parent:willPatch");
      }
      patched() {
        steps.push("parent:patched");
      }
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual([]);
    widget.state.n = 2;
    await nextTick();
    widget.destroy();
    expect(steps).toEqual([
      "parent:willPatch",
      "child:willPatch",
      "childchild:willPatch",
      "childchild:patched",
      "child:patched",
      "parent:patched"
    ]);
  });

  test("willStart, mounted on subwidget rendered after main is mounted in some other position", async () => {
    const steps: string[] = [];

    // the t-else part in the template is important. This is
    // necessary to have a situation that could confuse the vdom
    // patching algorithm
    env.qweb.addTemplate(
      "ParentWidget",
      `
          <div>
            <t t-if="state.ok">
              <t t-component="child"/>
            </t>
            <t t-else="">
              <div/>
            </t>
          </div>`
    );
    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      async willStart() {
        steps.push("child:willStart");
      }
      mounted() {
        steps.push("child:mounted");
      }
    }
    class ParentWidget extends Component<any, any> {
      state = useState({ ok: false });
      static components = { child: ChildWidget };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual([]);
    widget.state.ok = true;
    await nextTick();
    expect(steps).toEqual(["child:willStart", "child:mounted"]);
  });

  test("mounted hook is correctly called on subcomponents created in mounted hook", async () => {
    // the issue here is that the parent widget creates in the
    // mounted hook a new widget, which means that it modifies
    // in place its list of children. But this list of children is currently
    // being visited, so the mount action of the parent could cause a mount
    // action of the new child widget, even though it is not ready yet.
    expect.assertions(1);
    class ParentWidget extends Component<any, any> {
      static template = xml`<div/>`;
      mounted() {
        const child = new ChildWidget(this);
        child.mount(this.el!);
      }
    }
    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      mounted() {
        expect(this.el).toBeTruthy();
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture); // wait for ParentWidget
    await nextTick(); // wait for ChildWidget
  });

  test("components are unmounted and destroyed if no longer in DOM", async () => {
    let steps: string[] = [];

    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      constructor(parent) {
        super(parent);
        steps.push("init");
      }
      async willStart() {
        steps.push("willstart");
      }
      mounted() {
        steps.push("mounted");
      }
      willUnmount() {
        steps.push("willunmount");
      }
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.ok"><ChildWidget /></t>
        </div>
      `;
      static components = { ChildWidget };
      state = useState({ ok: true });
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual(["init", "willstart", "mounted"]);
    widget.state.ok = false;
    await nextTick();
    expect(steps).toEqual(["init", "willstart", "mounted", "willunmount"]);
  });

  test("components are unmounted and destroyed if no longer in DOM, even after updateprops", async () => {
    let childUnmounted = false;

    class ChildWidget extends Component<any, any> {
      static template = xml`<span><t t-esc="props.n"/></span>`;
      willUnmount() {
        childUnmounted = true;
      }
    }

    class ParentWidget extends Component<any, any> {
      static template = xml`
        <div>
          <div t-if="state.flag">
            <ChildWidget n="state.n"/>
          </div>
        </div>
      `;
      static components = { ChildWidget };
      state = useState({ n: 0, flag: true });
      increment() {
        this.state.n += 1;
      }
      toggleSubWidget() {
        this.state.flag = !this.state.flag;
      }
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div><span>0</span></div></div>");
    widget.increment();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div><span>1</span></div></div>");
    widget.toggleSubWidget();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");
    expect(childUnmounted).toBe(true);
  });

  test("hooks are called in proper order in widget creation/destruction", async () => {
    let steps: string[] = [];

    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      constructor(parent) {
        super(parent);
        steps.push("c init");
      }
      async willStart() {
        steps.push("c willstart");
      }
      mounted() {
        steps.push("c mounted");
      }
      willUnmount() {
        steps.push("c willunmount");
      }
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`<div><t t-component="child"/></div>`;
      static components = { child: ChildWidget };
      constructor(parent?) {
        super(parent);
        steps.push("p init");
      }
      async willStart() {
        steps.push("p willstart");
      }
      mounted() {
        steps.push("p mounted");
      }
      willUnmount() {
        steps.push("p willunmount");
      }
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    widget.destroy();
    expect(steps).toEqual([
      "p init",
      "p willstart",
      "c init",
      "c willstart",
      "c mounted",
      "p mounted",
      "p willunmount",
      "c willunmount"
    ]);
  });

  test("willUpdateProps hook is called", async () => {
    let def = makeDeferred();
    env.qweb.addTemplate("Parent", '<span><Child n="state.n"/></span>');
    class HookWidget extends Component<any, any> {
      static template = xml`<span><t t-esc="props.n"/></span>`;
      willUpdateProps(nextProps) {
        expect(nextProps.n).toBe(2);
        return def;
      }
    }
    class Parent extends Component<any, any> {
      state = useState({ n: 1 });
      static components = { Child: HookWidget };
    }
    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<span><span>1</span></span>");
    widget.state.n = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<span><span>1</span></span>");
    def.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<span><span>2</span></span>");
  });

  test("patched hook is called after updating State", async () => {
    let n = 0;

    class TestWidget extends Component<any, any> {
      static template = xml`<div/>`;
      state = useState({ a: 1 });

      patched() {
        n++;
      }
    }
    const widget = new TestWidget();
    await widget.mount(fixture);
    expect(n).toBe(0);

    widget.state.a = 1; // empty update, should do nothing
    await nextTick();
    expect(n).toBe(0);

    widget.state.a = 3;
    await nextTick();
    expect(n).toBe(1);
  });

  test("patched hook is called after updateProps", async () => {
    let n = 0;

    class TestWidget extends Component<any, any> {
      static template = xml`<div/>`;
      patched() {
        n++;
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child a="state.a"/></div>`;
      state = useState({ a: 1 });
      static components = { Child: TestWidget };
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(n).toBe(0);

    widget.state.a = 2;
    await nextTick();
    expect(n).toBe(1);
  });

  test("shouldUpdate hook prevent rerendering", async () => {
    let shouldUpdate = false;
    class TestWidget extends Component<any, any> {
      static template = xml`<div><t t-esc="props.val"/></div>`;
      shouldUpdate() {
        return shouldUpdate;
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child val="state.val"/></div>`;
      static components = { Child: TestWidget };
      state = useState({ val: 42 });
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>42</div></div>");
    widget.state.val = 123;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>42</div></div>");
    shouldUpdate = true;
    widget.state.val = 666;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>666</div></div>");
  });

  test("sub widget (inside sub node): hooks are correctly called", async () => {
    let created = false;
    let mounted = false;

    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      constructor(parent, props) {
        super(parent, props);
        created = true;
      }
      mounted() {
        mounted = true;
      }
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.flag">
            <div><t t-component="child"/></div>
          </t>
        </div>
      `;
      static components = { child: ChildWidget };
      state = useState({ flag: false });
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(created).toBe(false);
    expect(mounted).toBe(false);

    widget.state.flag = true;
    await nextTick();
    expect(mounted).toBe(true);
    expect(created).toBe(true);
  });

  test("willPatch/patched hook", async () => {
    const steps: string[] = [];

    class ChildWidget extends Component<any, any> {
      static template = xml`<div/>`;
      willPatch() {
        steps.push("child:willPatch");
      }
      patched() {
        steps.push("child:patched");
      }
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`
        <div>
          <t t-component="child" v="state.n"/>
        </div>
      `;
      static components = { child: ChildWidget };
      state = useState({ n: 1 });
      willPatch() {
        steps.push("parent:willPatch");
      }
      patched() {
        steps.push("parent:patched");
      }
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(steps).toEqual([]);
    widget.state.n = 2;
    await nextTick();

    // Not sure about this order.  If you disagree, feel free to open an issue...
    expect(steps).toEqual([
      "parent:willPatch",
      "child:willPatch",
      "child:patched",
      "parent:patched"
    ]);
  });
});

describe("destroy method", () => {
  test("destroy remove the widget from the DOM", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }

    const widget = new SomeComponent();
    await widget.mount(fixture);
    expect(document.contains(widget.el)).toBe(true);
    widget.destroy();
    expect(document.contains(widget.el)).toBe(false);
    expect(widget.__owl__.isMounted).toBe(false);
    expect(widget.__owl__.isDestroyed).toBe(true);
  });

  test("destroying a parent also destroys its children", async () => {
    const parent = new WidgetA();
    await parent.mount(fixture);

    const child = children(parent)[0];

    expect(child.__owl__.isDestroyed).toBe(false);
    parent.destroy();
    expect(child.__owl__.isDestroyed).toBe(true);
  });

  test("destroy remove the parent/children link", async () => {
    const parent = new WidgetA();
    await parent.mount(fixture);

    const child = children(parent)[0];
    expect(child.__owl__.parent).toBe(parent);
    expect(children(parent).length).toBe(1);
    child.destroy();
    expect(child.__owl__.parent).toBe(null);
    expect(children(parent).length).toBe(0);
  });

  test("destroying a widget before willStart is done", async () => {
    let def = makeDeferred();
    let isRendered = false;
    class DelayedWidget extends Component<any, any> {
      static template = xml`<div/>`;
      willStart() {
        return def;
      }
    }
    expect(fixture.innerHTML).toBe("");
    const widget = new DelayedWidget();
    widget.mount(fixture);
    expect(widget.__owl__.isMounted).toBe(false);
    expect(widget.__owl__.isDestroyed).toBe(false);
    widget.destroy();
    expect(widget.__owl__.isMounted).toBe(false);
    expect(widget.__owl__.isDestroyed).toBe(true);
    def.resolve();
    await nextTick();

    expect(widget.__owl__.isMounted).toBe(false);
    expect(widget.__owl__.isDestroyed).toBe(true);
    expect(widget.__owl__.vnode).toBe(undefined);
    expect(fixture.innerHTML).toBe("");
    expect(isRendered).toBe(false);
  });

  test("destroying a widget before being mounted", async () => {
    class GrandChild extends Component<any, any> {
      static template = xml`
        <span>
          <t t-esc="props.val.val"/>
        </span>
      `;
    }
    class Child extends Component<any, any> {
      static template = xml`
        <span>
          <GrandChild t-if="state.flag" val="something"/>
          <button t-on-click="doSomething">click</button>
        </span>
      `;
      static components = { GrandChild };
      state = useState({ val: 33, flag: false });
      doSomething() {
        this.state.val = 12;
        this.state.flag = true;
        this.trigger("some-event");
      }
      get something() {
        return { val: this.state.val };
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div t-on-some-event="doStuff">
          <Child />
        </div>
      `;
      static components = { Child };
      state = useState({ p: 1 });
      doStuff() {
        this.state.p = 2;
      }
    }

    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span><button>click</button></span></div>");
    fixture.querySelector("button")!.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span><span>12</span><button>click</button></span></div>");
  });

  test("destroying a widget before being mounted (2)", async () => {
    const steps: string[] = [];
    class Child extends Component<any, any> {
      static template = xml`<span></span>`;
      willStart() {
        steps.push("willStart");
        return makeDeferred();
      }
      __destroy(parent) {
        steps.push("__destroy");
        super.__destroy(parent);
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child t-if="state.flag"/></div>`;
      static components = { Child };
      state = useState({ flag: true });
    }

    const parent = new Parent();
    const prom = parent.mount(fixture);
    await nextTick(); // wait for Child to be instantiated
    parent.state.flag = false;
    await prom;
    expect(fixture.innerHTML).toBe("<div></div>");
    expect(steps).toEqual(["willStart", "__destroy"]);
  });
});

describe("composition", () => {
  test("a widget with a sub widget", async () => {
    const widget = new WidgetA();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>Hello<div>world</div></div>");
    expect(children(widget)[0].__owl__.parent).toBe(widget);
  });

  test("can use components from the global registry", async () => {
    QWeb.registerComponent("WidgetB", WidgetB);
    env.qweb.addTemplate("ParentWidget", `<div><t t-component="WidgetB"/></div>`);
    class ParentWidget extends Component<any, any> {}
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>world</div></div>");
    delete QWeb.components["WidgetB"];
  });

  test("can use dynamic components (the class) if given", async () => {
    class A extends Component<any, any> {
      static template = xml`<span>child a</span>`;
    }
    class B extends Component<any, any> {
      static template = xml`<span>child b</span>`;
    }
    class App extends Component<any, any> {
      static template = xml`<t t-component="myComponent" t-key="state.child"/>`;
      state = useState({
        child: "a"
      });
      get myComponent() {
        return this.state.child === "a" ? A : B;
      }
    }
    const widget = new App();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>child a</span>");
    widget.state.child = "b";
    await nextTick();
    expect(fixture.innerHTML).toBe("<span>child b</span>");
  });

  test("can use dynamic components (the class) if given (with different root tagname)", async () => {
    class A extends Component<any, any> {
      static template = xml`<span>child a</span>`;
    }
    class B extends Component<any, any> {
      static template = xml`<div>child b</div>`;
    }
    class App extends Component<any, any> {
      static template = xml`<t t-component="myComponent" t-key="state.child"/>`;
      state = useState({
        child: "a"
      });
      get myComponent() {
        return this.state.child === "a" ? A : B;
      }
    }
    const widget = new App();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>child a</span>");
    widget.state.child = "b";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>child b</div>");
  });

  test("don't fallback to global registry if widget defined locally", async () => {
    QWeb.registerComponent("WidgetB", WidgetB); // should not use this widget
    env.qweb.addTemplate("ParentWidget", `<div><t t-component="WidgetB"/></div>`);
    env.qweb.addTemplate("AnotherWidgetB", `<span>Belgium</span>`);
    class AnotherWidgetB extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { WidgetB: AnotherWidgetB };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>Belgium</span></div>");
    delete QWeb.components["WidgetB"];
  });

  test("can define components in template without t-component", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="P"><C a="1"/></div>
        <span t-name="C"><t t-esc="props.a"/></span>
      </templates>`);
    class C extends Component<any, any> {}
    class P extends Component<any, any> {
      static components = { C };
    }
    const parent = new P();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
  });

  test("display a nice error if it cannot find component", async () => {
    const consoleError = console.error;
    console.error = jest.fn();

    class SomeComponent extends Component<any, any> {}
    env.qweb.addTemplate("Parent", `<div><SomeMispelledWidget /></div>`);
    class Parent extends Component<any, any> {
      static components = { SomeWidget: SomeComponent };
    }
    const parent = new Parent();
    let error;
    try {
      await parent.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe('Cannot find the definition of component "SomeMispelledWidget"');
    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("modifying a sub widget", async () => {
    class Counter extends Component<any, any> {
      static template = xml`
      <div><t t-esc="state.counter"/><button t-on-click="state.counter++">Inc</button></div>`;
      state = useState({
        counter: 0
      });
    }

    env.qweb.addTemplate("ParentWidget", `<div><t t-component="Counter"/></div>`);
    class ParentWidget extends Component<any, any> {
      static components = { Counter };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>0<button>Inc</button></div></div>");
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>1<button>Inc</button></div></div>");
  });

  test("refs in a loop", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `<div>
        <t t-foreach="state.items" t-as="item">
          <t t-component="Child" t-ref="{{item}}" t-key="item"/>
        </t>
      </div>`
    );
    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { Child: SomeComponent };
      elem1 = useRef("1");
      elem2 = useRef("2");
      elem3 = useRef("3");
      elem4 = useRef("4");
      state = useState({ items: [1, 2, 3] });
    }
    const parent = new ParentWidget();
    await parent.mount(fixture);
    expect(parent.elem1.comp).toBeDefined();
    expect(parent.elem2.comp).toBeDefined();
    expect(parent.elem3.comp).toBeDefined();
    expect(parent.elem4.comp).toBeNull();
  });

  test("parent's elm for a children === children's elm, even after rerender", async () => {
    const widget = new WidgetA();
    await widget.mount(fixture);

    expect((<any>widget.__owl__.vnode!.children![1]).elm).toBe(
      (<any>children(widget)[0].__owl__.vnode).elm
    );
    await children(widget)[0].render();
    expect((<any>widget.__owl__.vnode!.children![1]).elm).toBe(
      (<any>children(widget)[0].__owl__.vnode).elm
    );
  });

  test("parent env is propagated to child components", async () => {
    const widget = new WidgetA();
    await widget.mount(fixture);

    expect(children(widget)[0].env).toBe(env);
  });

  test("rerendering a widget with a sub widget", async () => {
    class Counter extends Component<any, any> {
      static template = xml`
      <div><t t-esc="state.counter"/><button t-on-click="state.counter++">Inc</button></div>`;
      state = useState({
        counter: 0
      });
    }

    env.qweb.addTemplate("ParentWidget", `<div><t t-component="Counter"/></div>`);
    class ParentWidget extends Component<any, any> {
      static components = { Counter };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>1<button>Inc</button></div></div>");
    await widget.render();
    expect(fixture.innerHTML).toBe("<div><div>1<button>Inc</button></div></div>");
  });

  test("sub components are destroyed if no longer in dom, then recreated", async () => {
    class Counter extends Component<any, any> {
      static template = xml`
      <div><t t-esc="state.counter"/><button t-on-click="state.counter++">Inc</button></div>`;
      state = useState({
        counter: 0
      });
    }

    env.qweb.addTemplate("ParentWidget", `<div><t t-if="state.ok"><Counter /></t></div>`);
    class ParentWidget extends Component<any, any> {
      state = useState({ ok: true });
      static components = { Counter };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>1<button>Inc</button></div></div>");
    widget.state.ok = false;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");

    widget.state.ok = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>0<button>Inc</button></div></div>");
  });

  test("sub components rendered in a loop", async () => {
    env.qweb.addTemplate("ChildWidget", `<span><t t-esc="props.n"/></span>`);
    class ChildWidget extends Component<any, any> {}

    env.qweb.addTemplate(
      "Parent",
      `
        <div>
          <t t-foreach="state.numbers" t-as="number">
            <t t-component="ChildWidget" t-key="number" n="number"/>
          </t>
        </div>`
    );
    class Parent extends Component<any, any> {
      state = useState({
        numbers: [1, 2, 3]
      });
      static components = { ChildWidget };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <span>1</span>
        <span>2</span>
        <span>3</span>
      </div>
    `)
    );
  });

  test("sub components with some state rendered in a loop", async () => {
    let n = 1;
    env.qweb.addTemplate("ChildWidget", `<span><t t-esc="state.n"/></span>`);
    class ChildWidget extends Component<any, any> {
      state: any;
      constructor(parent) {
        super(parent);
        this.state = useState({ n });
        n++;
      }
    }

    env.qweb.addTemplate(
      "parent",
      `<div>
          <t t-foreach="state.numbers" t-as="number">
            <t t-component="ChildWidget" t-key="number"/>
          </t>
        </div>`
    );
    class Parent extends Component<any, any> {
      static template = "parent";
      state = useState({
        numbers: [1, 2, 3]
      });
      static components = { ChildWidget };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    parent.state.numbers = [1, 3];
    await nextTick();
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <span>1</span>
        <span>3</span>
      </div>
    `)
    );
    expect(env.qweb.templates.parent.fn.toString()).toMatchSnapshot();
  });

  test("sub components between t-ifs", async () => {
    // this confuses the patching algorithm...
    class ChildWidget extends Component<any, any> {
      static template = xml`<span>child</span>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <h1 t-if="state.flag">hey</h1>
          <h2 t-else="">noo</h2>
          <span><ChildWidget/></span>
          <t t-if="state.flag"><span>test</span></t>
        </div>`;
      static components = { ChildWidget };
      state = useState({ flag: false });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    const child = children(parent)[0];
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
        <div>
          <h2>noo</h2>
          <span><span>child</span></span>
        </div>
      `)
    );

    parent.state.flag = true;
    await nextTick();
    expect(children(parent)[0]).toBe(child);
    expect(child.__owl__.isDestroyed).toBe(false);
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <h1>hey</h1>
        <span><span>child</span></span>
        <span>test</span>
      </div>
    `)
    );
  });

  test("list of sub components inside other nodes", async () => {
    // this confuses the patching algorithm...
    env.qweb.addTemplate("ChildWidget", `<span>child</span>`);

    env.qweb.addTemplates(`
        <templates>
            <div t-name="Parent">
                <div t-foreach="state.blips" t-as="blip" t-key="blip.id">
                    <SubWidget />
                </div>
            </div>
            <span t-name="SubWidget">asdf</span>
        </templates>`);

    class SubWidget extends Component<any, any> {}
    class Parent extends Component<any, any> {
      static components = { SubWidget };
      state = useState({
        blips: [
          { a: "a", id: 1 },
          { b: "b", id: 2 },
          { c: "c", id: 4 }
        ]
      });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe(
      "<div><div><span>asdf</span></div><div><span>asdf</span></div><div><span>asdf</span></div></div>"
    );
    parent.state.blips.splice(0, 1);
    await nextTick();
    expect(fixture.innerHTML).toBe(
      "<div><div><span>asdf</span></div><div><span>asdf</span></div></div>"
    );
  });

  test("list of two sub components inside other nodes", async () => {
    // this confuses the patching algorithm...
    env.qweb.addTemplate("ChildWidget", `<span>child</span>`);

    env.qweb.addTemplates(`
        <templates>
            <div t-name="Parent">
                <div t-foreach="state.blips" t-as="blip" t-key="blip.id">
                    <SubWidget />
                    <SubWidget />
                </div>
            </div>
            <span t-name="SubWidget">asdf</span>
        </templates>`);

    class SubWidget extends Component<any, any> {}
    class Parent extends Component<any, any> {
      static components = { SubWidget };
      state = useState({ blips: [{ a: "a", id: 1 }] });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div><span>asdf</span><span>asdf</span></div></div>");
  });

  test("t-component with dynamic value", async () => {
    env.qweb.addTemplate("ParentWidget", `<div><t t-component="{{state.widget}}"/></div>`);
    class ParentWidget extends Component<any, any> {
      static components = { WidgetB };
      state = useState({ widget: "WidgetB" });
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>world</div></div>");
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-component with dynamic value 2", async () => {
    env.qweb.addTemplate("ParentWidget", `<div><t t-component="Widget{{state.widget}}"/></div>`);
    class ParentWidget extends Component<any, any> {
      static components = { WidgetB };
      state = useState({ widget: "B" });
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>world</div></div>");
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-component not on a <t> node", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span>1</span>`;
    }
    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<div><div t-component="Child"/></div>`;
    }
    const parent = new Parent();
    let error;
    try {
      await parent.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe(
      `Directive 't-component' can only be used on <t> nodes (used on a <div>)`
    );
  });

  test("sub components, loops, and shouldUpdate", async () => {
    class ChildWidget extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
      shouldUpdate(nextProps) {
        if (nextProps.val === 12) {
          return false;
        }
        return true;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`
          <div>
            <t t-foreach="state.records" t-as="record">
              <ChildWidget t-key="record.id" val="record.val"/>
            </t>
          </div>`;
      state = useState({
        records: [
          { id: 1, val: 1 },
          { id: 2, val: 2 },
          { id: 3, val: 3 }
        ]
      });
      static components = { ChildWidget };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(normalize(fixture.innerHTML)).toBe(
      "<div><span>1</span><span>2</span><span>3</span></div>"
    );

    parent.state.records[0].val = 11;
    parent.state.records[1].val = 12;
    parent.state.records[2].val = 13;
    await nextTick();
    expect(normalize(fixture.innerHTML)).toBe(
      "<div><span>11</span><span>2</span><span>13</span></div>"
    );
  });

  test("three level of components with collapsing root nodes", async () => {
    class GrandChild extends Component<any, any> {
      static template = xml`<div>2</div>`;
    }
    class Child extends Component<any, any> {
      static components = { GrandChild };
      static template = xml`<GrandChild/>`;
    }
    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<Child></Child>`;
    }

    const app = new Parent();
    await app.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>2</div>");
  });
});

describe("props evaluation ", () => {
  test("explicit object prop", async () => {
    env.qweb.addTemplate("Parent", `<div><t t-component="child" value="state.val"/></div>`);
    class Child extends Component<any, any> {
      state: { someval: number };
      constructor(parent: Parent, props: { value: number }) {
        super(parent);
        this.state = useState({ someval: props.value });
      }
    }
    class Parent extends Component<any, any> {
      static components = { child: Child };
      state = useState({ val: 42 });
    }

    env.qweb.addTemplate("Child", `<span><t t-esc="state.someval"/></span>`);

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>42</span></div>");
  });

  test("accept ES6-like syntax for props (with getters)", async () => {
    env.qweb.addTemplate("Child", `<span><t t-esc="props.greetings"/></span>`);
    class Child extends Component<any, any> {}

    env.qweb.addTemplate("Parent", `<div><t t-component="child" greetings="greetings"/></div>`);
    class Parent extends Component<any, any> {
      static components = { child: Child };
      get greetings() {
        const name = "aaron";
        return `hello ${name}`;
      }
    }
    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>hello aaron</span></div>");
  });

  test("t-set works ", async () => {
    class Child extends Component<any, any> {}
    env.qweb.addTemplate(
      "Parent",
      `
        <div>
          <t t-set="val" t-value="42"/>
          <t t-component="child" val="val"/>
        </div>`
    );
    class Parent extends Component<any, any> {
      static components = { child: Child };
    }
    env.qweb.addTemplate(
      "Child",
      `
        <span>
          <t t-esc="props.val"/>
        </span>`
    );

    const widget = new Parent();
    await widget.mount(fixture);
    expect(normalize(fixture.innerHTML)).toBe("<div><span>42</span></div>");
  });
});

describe("class and style attributes with t-component", () => {
  test("class is properly added on widget root el", async () => {
    class Child extends Component<any, any> {
      static template = xml`<div class="c"/>`;
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`<div><Child class="a b"/></div>`;
      static components = { Child };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div><div class="c a b"></div></div>`);
  });

  test("empty class attribute is not added on widget root el", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span/>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child class=""/></div>`;
      static components = { Child };
    }
    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div><span></span></div>`);
  });

  test("t-att-class is properly added/removed on widget root el", async () => {
    class Child extends Component<any, any> {
      static template = xml`<div class="c"/>`;
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`<div><Child t-att-class="{a:state.a, b:state.b}"/></div>`;
      static components = { Child };
      state = useState({ a: true, b: false });
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div><div class="c a"></div></div>`);
    expect(QWeb.TEMPLATES[ParentWidget.template].fn.toString());

    widget.state.a = false;
    widget.state.b = true;
    await nextTick();
    expect(fixture.innerHTML).toBe(`<div><div class="c b"></div></div>`);
  });

  test("class with extra whitespaces", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `<div>
            <Child class="a  b c   d"/>
      </div>`
    );
    class Child extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { Child };
    }
    env.qweb.addTemplate("Child", `<div/>`);
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div><div class="a b c d"></div></div>`);
  });

  test("t-att-class is properly added/removed on widget root el (v2)", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <Child class="a" t-att-class="{ b: state.b }" t-ref="child"/>
        </div>
        <span t-name="Child" class="c" t-att-class="{ d: state.d }"/>
      </templates>`);

    class Child extends Component<any, any> {
      state = useState({ d: true });
    }
    class ParentWidget extends Component<any, any> {
      static components = { Child };
      state = useState({ b: true });
      child = useRef("child");
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);

    const span = fixture.querySelector("span")!;
    expect(span.className).toBe("c d a b");

    widget.state.b = false;
    await nextTick();
    expect(span.className).toBe("c d a");

    (widget.child.comp as Child).state.d = false;
    await nextTick();
    expect(span.className).toBe("c a");

    widget.state.b = true;
    await nextTick();
    expect(span.className).toBe("c a b");

    (widget.child.comp as Child).state.d = true;
    await nextTick();
    expect(span.className).toBe("c a b d");
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
    expect(env.qweb.templates.Child.fn.toString()).toMatchSnapshot();
  });

  test("t-att-class is properly added/removed on widget root el (v3)", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <Child class="a" t-att-class="state.b ? 'b' : ''" t-ref="child"/>
        </div>
        <span t-name="Child" class="c" t-att-class="state.d ? 'd' : ''"/>
      </templates>`);

    class Child extends Component<any, any> {
      state = useState({ d: true });
    }
    class ParentWidget extends Component<any, any> {
      static components = { Child };
      state = useState({ b: true });
      child = useRef("child");
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);

    const span = fixture.querySelector("span")!;
    expect(span.className).toBe("c d a b");

    widget.state.b = false;
    await nextTick();
    expect(span.className).toBe("c d a");

    (widget.child.comp as Child).state.d = false;
    await nextTick();
    expect(span.className).toBe("c a");

    widget.state.b = true;
    await nextTick();
    expect(span.className).toBe("c a b");

    (widget.child.comp as Child).state.d = true;
    await nextTick();
    expect(span.className).toBe("c a b d");
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
    expect(env.qweb.templates.Child.fn.toString()).toMatchSnapshot();
  });

  test("class on components do not interfere with user defined classes", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="App" t-att-class="{ c: state.c }" />
      </templates>`);

    class App extends Component<any, any> {
      state = useState({ c: true });
      mounted() {
        this.el!.classList.add("user");
      }
    }

    const widget = new App();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe('<div class="c user"></div>');

    widget.state.c = false;
    await nextTick();

    expect(fixture.innerHTML).toBe('<div class="user"></div>');
  });

  test("style is properly added on widget root el", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `
        <div>
            <t t-component="child" style="font-weight: bold;"/>
        </div>`
    );

    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }

    class ParentWidget extends Component<any, any> {
      static components = { child: SomeComponent };
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div><div style="font-weight: bold;"></div></div>`);
  });

  test("dynamic t-att-style is properly added and updated on widget root el", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `
        <div>
            <t t-component="child" t-att-style="state.style"/>
        </div>`
    );

    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }

    class ParentWidget extends Component<any, any> {
      static components = { child: SomeComponent };
      state = useState({ style: "font-size: 20px" });
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);

    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();

    expect(fixture.innerHTML).toBe(`<div><div style="font-size: 20px;"></div></div>`);

    widget.state.style = "font-size: 30px";
    await nextTick();

    expect(fixture.innerHTML).toBe(`<div><div style="font-size: 30px;"></div></div>`);
  });

  test("error in subcomponent with class", async () => {
    class Child extends Component<any, any> {
      static template = xml`<div t-esc="this.will.crash"/>`;
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`<div><Child class="a"/></div>`;
      static components = { Child };
    }
    const widget = new ParentWidget();
    let error;
    try {
      await widget.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot read property 'crash' of undefined");
    expect(fixture.innerHTML).toBe("");
  });
});

describe("other directives with t-component", () => {
  test("t-on works as expected", async () => {
    expect.assertions(4);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget"><t t-component="child" t-on-custom-event="someMethod"/></div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      n = 0;
      someMethod(ev) {
        expect(ev.detail).toBe(43);
        this.n++;
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    let child = children(widget)[0];
    expect(widget.n).toBe(0);
    child.trigger("custom-event", 43);
    expect(widget.n).toBe(1);
    child.destroy();
    child.trigger("custom-event", 43);
    expect(widget.n).toBe(1);
  });

  test("t-on works, even if flush is called many times", async () => {
    let flag = false;
    let mounted = false;
    class Child extends Component<any, any> {
      static template = xml`<span>child</span>`;
      mounted() {
        mounted = true;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><Child t-on-click="doSomething"/></div>`;
      static components = { Child };

      doSomething() {
        flag = true;
      }
    }

    const parent = new Parent();
    parent.mount(fixture);
    while (!mounted) {
      await nextMicroTick();
      Component.scheduler.flush();
    }

    expect(fixture.innerHTML).toBe("<div><span>child</span></div>");
    expect(flag).toBe(false);
    fixture.querySelector("span")!.click();
    expect(flag).toBe(true);
  });

  test("t-on with inline statement", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span>child</span>`;
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><Child t-on-click="state.n = state.n + 1"/></div>`;
      static components = { Child };
      state = { n: 3 };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(parent.state.n).toBe(3);
    fixture.querySelector("span")!.click();
    expect(parent.state.n).toBe(4);
  });

  test("t-on with handler bound to argument", async () => {
    expect.assertions(3);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget"><t t-component="child" t-on-ev="onEv(3)"/></div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv(n, ev) {
        expect(n).toBe(3);
        expect(ev.detail).toBe(43);
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    let child = children(widget)[0];
    child.trigger("ev", 43);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with handler bound to object", async () => {
    expect.assertions(3);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget"><t t-component="child" t-on-ev="onEv({val: 3})"/></div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv(o, ev) {
        expect(o).toEqual({ val: 3 });
        expect(ev.detail).toBe(43);
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    let child = children(widget)[0];
    child.trigger("ev", 43);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with handler bound to empty object", async () => {
    expect.assertions(3);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget"><t t-component="child" t-on-ev="onEv({})"/></div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv(o, ev) {
        expect(o).toEqual({});
        expect(ev.detail).toBe(43);
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    let child = children(widget)[0];
    child.trigger("ev", 43);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with handler bound to empty object (with non empty inner string)", async () => {
    expect.assertions(3);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget"><t t-component="child" t-on-ev="onEv({  })"/></div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv(o, ev) {
        expect(o).toEqual({});
        expect(ev.detail).toBe(43);
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    let child = children(widget)[0];
    child.trigger("ev", 43);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with stop and/or prevent modifiers", async () => {
    expect.assertions(7);
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <t t-component="child"
           t-on-ev-1.stop="onEv1"
           t-on-ev-2.prevent="onEv2"
           t-on-ev-3.stop.prevent="onEv3"/>
        </div>
      </templates>
    `);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv1(ev) {
        expect(ev.defaultPrevented).toBe(false);
        expect(ev.cancelBubble).toBe(true);
      }
      onEv2(ev) {
        expect(ev.defaultPrevented).toBe(true);
        expect(ev.cancelBubble).toBe(false);
      }
      onEv3(ev) {
        expect(ev.defaultPrevented).toBe(true);
        expect(ev.cancelBubble).toBe(true);
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);

    const child = children(widget)[0];
    child.trigger("ev-1");
    child.trigger("ev-2");
    child.trigger("ev-3");
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with self modifier", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <t t-component="child" t-on-ev-1="onEv1" t-on-ev-2.self="onEv2"/>
        </div>
        <div t-name="Child"><t t-component="child"/></div>
      </templates>
    `);
    const steps: string[] = [];
    class GrandChild extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class Child extends Component<any, any> {
      static components = { child: GrandChild };
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv1(ev) {
        steps.push("onEv1");
      }
      onEv2(ev) {
        steps.push("onEv2");
      }
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);

    const child = children(widget)[0];
    const grandChild = children(child)[0];
    child.trigger("ev-1");
    child.trigger("ev-2");
    expect(steps).toEqual(["onEv1", "onEv2"]);
    grandChild.trigger("ev-1");
    grandChild.trigger("ev-2");
    expect(steps).toEqual(["onEv1", "onEv2", "onEv1"]);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with self and prevent modifiers (order matters)", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <t t-component="child" t-on-ev.self.prevent="onEv"/>
        </div>
        <div t-name="Child"><t t-component="child"/></div>
      </templates>
    `);
    const steps: boolean[] = [];
    class GrandChild extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class Child extends Component<any, any> {
      static components = { child: GrandChild };
    }
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      onEv() {}
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    (<HTMLElement>fixture).addEventListener("ev", function(e) {
      steps.push(e.defaultPrevented);
    });

    const child = children(widget)[0];
    const grandChild = children(child)[0];
    child.trigger("ev");
    grandChild.trigger("ev");
    expect(steps).toEqual([true, false]);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with prevent and self modifiers (order matters)", async () => {
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ParentWidget">
          <Child t-on-ev.prevent.self="onEv"/>
        </div>
        <div t-name="Child"><GrandChild/></div>
      </templates>
    `);
    const steps: boolean[] = [];
    class GrandChild extends Component<any, any> {
      static template = xml`<div/>`;
    }

    class Child extends Component<any, any> {
      static components = { GrandChild };
    }
    class ParentWidget extends Component<any, any> {
      static components = { Child };
      onEv() {}
    }
    const widget = new ParentWidget();
    await widget.mount(fixture);
    (<HTMLElement>fixture).addEventListener("ev", function(e) {
      steps.push(e.defaultPrevented);
    });

    const child = children(widget)[0];
    const grandChild = children(child)[0];
    child.trigger("ev");
    grandChild.trigger("ev");
    expect(steps).toEqual([true, true]);
    expect(env.qweb.templates.ParentWidget.fn.toString()).toMatchSnapshot();
  });

  test("t-on with getter as handler", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <t t-esc="state.counter"/>
          <Child t-on-ev="handler"/>
        </div>`;
      static components = { Child };
      state = useState({ counter: 0 });
      get handler() {
        this.state.counter++;
        return () => {};
      }
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
    expect(fixture.innerHTML).toBe("<div>0<span></span></div>");

    let child = children(parent)[0];
    child.trigger("ev");
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>1<span></span></div>");
  });

  test("t-on with inline statement", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <t t-esc="state.counter"/>
          <Child t-on-ev="state.counter++"/>
        </div>`;
      static components = { Child };
      state = useState({ counter: 0 });
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
    expect(fixture.innerHTML).toBe("<div>0<span></span></div>");

    let child = children(parent)[0];
    child.trigger("ev");
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>1<span></span></div>");
  });

  test("t-on with no handler (only modifiers)", async () => {
    expect.assertions(2);
    class ComponentB extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    class ComponentA extends Component<any, any> {
      static template = xml`<p><ComponentB t-on-ev.prevent=""/></p>`;
      static components = { ComponentB };
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><ComponentA t-on-ev="onEv"/></div>`;
      static components = { ComponentA };
      onEv(ev) {
        expect(ev.defaultPrevented).toBe(true);
      }
    }
    const parent = new Parent();
    await parent.mount(fixture);

    let componentB = children(children(parent)[0])[0];
    componentB.trigger("ev");

    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
  });

  test("t-on on nested components with collapsing root nodes", async () => {
    const steps: string[] = [];
    let grandChild;
    class GrandChild extends Component<any, any> {
      static template = xml`<span t-on-ev="_onEv"/>`;
      constructor() {
        super(...arguments);
        grandChild = this;
      }
      _onEv() {
        steps.push("GrandChild");
      }
    }
    class Child extends Component<any, any> {
      static template = xml`<GrandChild t-on-ev="_onEv"/>`;
      static components = { GrandChild };
      _onEv() {
        steps.push("Child");
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<Child t-on-ev="_onEv"/>`;
      static components = { Child };
      _onEv() {
        steps.push("Parent");
      }
    }
    const parent = new Parent();
    await parent.mount(fixture);

    grandChild.trigger("ev");
    expect(steps).toEqual(["GrandChild", "Child", "Parent"]);
  });

  test("t-on on unmounted components", async () => {
    const steps: string[] = [];
    let child;
    class Child extends Component<any, any> {
      static template = xml`<div t-on-click="onClick"/>`;
      mounted() {
        child = this;
      }
      onClick() {
        steps.push("click");
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child/></div>`;
      static components = { Child };
      state = useState({ flag: true });
    }
    const parent = new Parent();
    await parent.mount(fixture);

    let el = child.el;
    el.click();
    expect(steps).toEqual(["click"]);
    parent.unmount();
    expect(child.__owl__.isMounted).toBe(false);
    el.click();
    expect(steps).toEqual(["click"]);
  });

  test("t-on on destroyed components", async () => {
    const steps: string[] = [];
    let child;
    class Child extends Component<any, any> {
      static template = xml`<div t-on-click="onClick"/>`;
      mounted() {
        child = this;
      }
      onClick() {
        steps.push("click");
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child t-if="state.flag"/></div>`;
      static components = { Child };
      state = useState({ flag: true });
    }
    const parent = new Parent();
    await parent.mount(fixture);

    let el = child.el;
    el.click();
    expect(steps).toEqual(["click"]);
    parent.state.flag = false;
    await nextTick();
    expect(child.__owl__.isDestroyed).toBe(true);
    el.click();
    expect(steps).toEqual(["click"]);
  });

  test("t-on on destroyed components, part 2", async () => {
    const steps: string[] = [];
    let child;
    class GrandChild extends Component<any, any> {
      static template = xml`<div>grandchild</div>`;
    }
    class Child extends Component<any, any> {
      static template = xml`<div><GrandChild t-ref="gc" t-on-click="onClick"/></div>`;
      static components = { GrandChild };
      gc = useRef("gc");
      mounted() {
        child = this;
      }
      onClick() {
        steps.push("click");
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child t-if="state.flag"/></div>`;
      static components = { Child };
      state = useState({ flag: true });
    }
    const parent = new Parent();
    await parent.mount(fixture);

    let el = child.gc.el;
    el.click();
    expect(steps).toEqual(["click"]);
    parent.state.flag = false;
    await nextTick();
    expect(child.__owl__.isDestroyed).toBe(true);
    el.click();
    expect(steps).toEqual(["click"]);
  });

  test("t-if works with t-component", async () => {
    env.qweb.addTemplate("ParentWidget", `<div><t t-component="child" t-if="state.flag"/></div>`);
    class Child extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: true });
    }
    env.qweb.addTemplate("Child", "<span>hey</span>");

    const widget = new ParentWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>hey</span></div>");

    widget.state.flag = false;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");

    widget.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>hey</span></div>");
  });

  test("t-else works with t-component", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `
        <div>
          <div t-if="state.flag">somediv</div>
          <t t-else="" t-component="child"/>
        </div>`
    );
    class Child extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: true });
    }
    env.qweb.addTemplate("Child", "<span>hey</span>");

    const widget = new ParentWidget();
    await widget.mount(fixture);

    expect(normalize(fixture.innerHTML)).toBe("<div><div>somediv</div></div>");

    widget.state.flag = false;
    await nextTick();
    expect(normalize(fixture.innerHTML)).toBe("<div><span>hey</span></div>");
  });

  test("t-elif works with t-component", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `
        <div>
          <div t-if="state.flag">somediv</div>
          <t t-elif="!state.flag" t-component="child"/>
        </div>`
    );
    class Child extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: true });
    }
    env.qweb.addTemplate("Child", "<span>hey</span>");

    const widget = new ParentWidget();
    await widget.mount(fixture);

    expect(normalize(fixture.innerHTML)).toBe("<div><div>somediv</div></div>");

    widget.state.flag = false;
    await nextTick();
    expect(normalize(fixture.innerHTML)).toBe("<div><span>hey</span></div>");
  });

  test("t-else with empty string works with t-component", async () => {
    env.qweb.addTemplate(
      "ParentWidget",
      `
        <div>
          <div t-if="state.flag">somediv</div>
          <t t-else="" t-component="child"/>
        </div>`
    );
    class Child extends Component<any, any> {}
    class ParentWidget extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: true });
    }
    env.qweb.addTemplate("Child", "<span>hey</span>");

    const widget = new ParentWidget();
    await widget.mount(fixture);

    expect(normalize(fixture.innerHTML)).toBe("<div><div>somediv</div></div>");

    widget.state.flag = false;
    await nextTick();
    expect(normalize(fixture.innerHTML)).toBe("<div><span>hey</span></div>");
  });

  test("t-foreach with t-component, and update", async () => {
    class Child extends Component<any, any> {
      static template = xml`
        <span>
          <t t-esc="state.val"/>
          <t t-esc="props.val"/>
        </span>`;
      state = useState({ val: "A" });
      mounted() {
        this.state.val = "B";
      }
    }
    class ParentWidget extends Component<any, any> {
      static components = { Child };
      static template = xml`
        <div>
          <t t-foreach="Array(2)" t-as="n" t-key="n_index">
            <Child val="n_index"/>
          </t>
        </div>`;
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>A0</span><span>A1</span></div>");

    await nextTick(); // wait for changes triggered in mounted to be applied
    expect(fixture.innerHTML).toBe("<div><span>B0</span><span>B1</span></div>");
  });

  test("t-set outside modified in t-foreach", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <t t-set="iter" t-value="0"/>
        <t t-foreach="state.values" t-as="val" t-key="val">
          <p>InLoop: <t t-esc="iter"/></p>
          <t t-set="iter" t-value="iter + 1"/>
        </t>
        <p>EndLoop: <t t-esc="iter"/></p>
      </div>`;

      state = useState({values: ['a', 'b']});
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>InLoop: 0</p><p>InLoop: 1</p><p>EndLoop: 2</p></div>");
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("t-set can't alter component", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <p><t t-esc="iter"/></p>
        <t t-set="iter" t-value="5"/>
        <p><t t-esc="iter"/></p>
      </div>`;

      iter = 1;
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>1</p><p>5</p></div>");
    expect(widget.iter).toBe(1);
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("t-set can't alter from within callee", async () => {
    env.qweb.addTemplate("ChildWidget", `<div><t t-esc="iter"/><t t-set="iter" t-value="'called'"/><t t-esc="iter"/></div>`);
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <t t-set="iter" t-value="'source'"/>
        <p><t t-esc="iter"/></p>
        <t t-call="ChildWidget"/>
        <p><t t-esc="iter"/></p>
      </div>`;
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>source</p><div>sourcecalled</div><p>source</p></div>");
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("t-set can't alter in t-call body", async () => {
    env.qweb.addTemplate("ChildWidget", `<div><t t-esc="iter"/><t t-set="iter" t-value="'called'"/><t t-esc="iter"/></div>`);
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <t t-set="iter" t-value="'source'"/>
        <p><t t-esc="iter"/></p>
        <t t-call="ChildWidget">
          <t t-set="iter" t-value="'inCall'"/>
        </t>
        <p><t t-esc="iter"/></p>
      </div>`;
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>source</p><div>inCallcalled</div><p>source</p></div>");
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("slot setted value (with t-set) not accessible with t-esc", async () => {
    class ChildWidget extends Component<any, any> {
      static template = xml`<div><t t-esc="iter"/><t t-set="iter" t-value="'called'"/><t t-esc="iter"/></div>`;
    }
    class SomeWidget extends Component<any, any> {
      static components = { ChildWidget };
      static template = xml`
      <div>
        <t t-set="iter" t-value="'source'"/>
        <p><t t-esc="iter"/></p>
        <ChildWidget>
          <t t-set="iter" t-value="'inCall'"/>
        </ChildWidget>
        <p><t t-esc="iter"/></p>
      </div>`;
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>source</p><div>called</div><p>source</p></div>");
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("t-set not altered by child widget", async () => {
    let child;
    class ChildWidget extends Component<any, any> {
      static template = xml`<div><t t-esc="iter"/><t t-set="iter" t-value="'called'"/><t t-esc="iter"/></div>`;
      iter = 'child';
      constructor() {
        super(...arguments);
        child = this;
      }
    }
    class SomeWidget extends Component<any, any> {
      static components = { ChildWidget };
      static template = xml`
      <div>
        <t t-set="iter" t-value="'source'"/>
        <p><t t-esc="iter"/></p>
        <ChildWidget/>
        <p><t t-esc="iter"/></p>
      </div>`;
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>source</p><div>childcalled</div><p>source</p></div>");
    expect(child.iter).toBe('child');
    expect(QWeb.TEMPLATES[SomeWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("t-set outside modified in t-foreach increment-after operator", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <t t-set="iter" t-value="0"/>
        <t t-foreach="state.values" t-as="val" t-key="val">
          <p>InLoop: <t t-esc="iter"/></p>
          <t t-set="iter" t-value="iter++"/>
        </t>
        <p>EndLoop: <t t-esc="iter"/></p>
      </div>`;

      state = useState({values: ['a', 'b']});
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><p>InLoop: 0</p><p>InLoop: 1</p><p>EndLoop: 0</p></div>");
  });

  test("t-set outside modified in t-foreach increment-before operator", async () => {
    class SomeWidget extends Component<any, any> {
      static template = xml`
      <div>
        <t t-set="iter" t-value="0"/>
        <t t-foreach="state.values" t-as="val" t-key="val">
          <p>InLoop: <t t-esc="iter"/></p>
          <t t-set="iter" t-value="++iter"/>
        </t>
        <p>EndLoop: <t t-esc="iter"/></p>
      </div>`;

      state = useState({values: ['a', 'b']});
    }
    const widget = new SomeWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><p>InLoop: 0</p><p>InLoop: 1</p><p>EndLoop: 1</p></div>");
  });
});

describe("random stuff/miscellaneous", () => {
  test("widget after a t-foreach", async () => {
    // this test makes sure that the foreach directive does not pollute sub
    // context with the inLoop variable, which is then used in the t-component
    // directive as a key
    env.qweb.addTemplate(
      "Test",
      `<div><t t-foreach="Array(2)">txt</t><t t-component="widget"/></div>`
    );

    class SomeComponent extends Component<any, any> {
      static template = xml`<div/>`;
    }

    class Test extends Component<any, any> {
      static components = { widget: SomeComponent };
    }
    const widget = new Test();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>txttxt<div></div></div>");
  });

  test("t-on with handler bound to dynamic argument on a t-foreach", async () => {
    expect.assertions(3);

    class Child extends Component<any, any> {
      static template = xml`<div/>`;
    }
    class ParentWidget extends Component<any, any> {
      static template = xml`
        <div>
          <t t-foreach="items" t-as="item">
            <Child t-key="item" t-on-ev="onEv(item)"/>
          </t>
        </div>`;
      static components = { Child };
      items = [1, 2, 3, 4];
      onEv(n, ev) {
        expect(n).toBe(1);
        expect(ev.detail).toBe(43);
      }
    }

    const widget = new ParentWidget();
    await widget.mount(fixture);
    children(widget)[0].trigger("ev", 43);
    expect(env.qweb.templates[ParentWidget.template].fn.toString()).toMatchSnapshot();
  });

  test("updating widget immediately", async () => {
    // in this situation, we protect against a bug that occurred: because of the
    // interplay between components and vnodes, a sub widget vnode was patched
    // twice.
    env.qweb.addTemplate("Parent", `<div><t t-component="child" flag="state.flag"/></div>`);
    class Child extends Component<any, any> {}
    class Parent extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: false });
    }

    env.qweb.addTemplate("Child", `<span>abc<t t-if="props.flag">def</t></span>`);

    const widget = new Parent();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>abc</span></div>");
    widget.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>abcdef</span></div>");
  });

  test("snapshotting compiled code", async () => {
    env.qweb.addTemplate(
      "Parent",
      `<div><t t-component="child" t-key="'somestring'" flag="state.flag"/></div>`
    );
    class Child extends Component<any, any> {}
    class Parent extends Component<any, any> {
      static components = { child: Child };
      state = useState({ flag: false });
    }

    env.qweb.addTemplate("Child", `<span>abc<t t-if="props.flag">def</t></span>`);

    const widget = new Parent();
    await widget.mount(fixture);
    expect(env.qweb.templates.Parent.fn.toString()).toMatchSnapshot();
  });

  test("component semantics", async () => {
    let steps: string[] = [];
    let c: C;

    class TestWidget extends Component<any, any> {
      name: string = "test";
      async willStart() {
        steps.push(`${this.name}:willStart`);
      }
      __render(f) {
        steps.push(`${this.name}:render`);
        return super.__render(f);
      }
      __patch(vnode) {
        steps.push(`${this.name}:__patch`);
        super.__patch(vnode);
      }
      mounted() {
        steps.push(`${this.name}:mounted`);
      }
      async willUpdateProps() {
        steps.push(`${this.name}:willUpdateProps`);
      }
      willPatch() {
        steps.push(`${this.name}:willPatch`);
      }
      patched() {
        steps.push(`${this.name}:patched`);
      }
      willUnmount() {
        steps.push(`${this.name}:willUnmount`);
      }
      destroy() {
        super.destroy();
        steps.push(`${this.name}:destroy`);
      }
    }
    env.qweb.addTemplate("B", `<div>B</div>`);
    class B extends TestWidget {
      name = "B";
      constructor(parent, props) {
        super(parent, props);
        steps.push("B:constructor");
      }
    }
    env.qweb.addTemplate("D", `<div>D</div>`);
    class D extends TestWidget {
      name = "D";
      constructor(parent, props) {
        super(parent, props);
        steps.push("D:constructor");
      }
    }
    env.qweb.addTemplate("E", `<div>E</div>`);
    class E extends TestWidget {
      name = "E";
      constructor(parent, props) {
        super(parent, props);
        steps.push("E:constructor");
      }
    }

    env.qweb.addTemplate("F", `<div>F</div>`);
    class F extends TestWidget {
      name = "F";
      constructor(parent, props) {
        super(parent, props);
        steps.push("F:constructor");
      }
    }
    env.qweb.addTemplate(
      "C",
      `
        <div>C<D />
            <E t-if="state.flag" />
            <F t-else="!state.flag" />
        </div>`
    );
    class C extends TestWidget {
      static components = { D, E, F };
      name = "C";
      state = useState({ flag: true });

      constructor(parent, props) {
        super(parent, props);
        c = this;
        steps.push("C:constructor");
      }
    }
    env.qweb.addTemplate("A", `<div>A<B /><C /></div>`);
    class A extends TestWidget {
      static components = { B, C };
      name = "A";
    }

    const a = new A();
    await a.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div>A<div>B</div><div>C<div>D</div><div>E</div></div></div>`);
    expect(steps).toEqual([
      "A:willStart",
      "A:render",
      "B:constructor",
      "B:willStart",
      "C:constructor",
      "C:willStart",
      "B:render",
      "C:render",
      "D:constructor",
      "D:willStart",
      "E:constructor",
      "E:willStart",
      "D:render",
      "E:render",
      "E:__patch",
      "D:__patch",
      "C:__patch",
      "B:__patch",
      "A:__patch",
      "E:mounted",
      "D:mounted",
      "C:mounted",
      "B:mounted",
      "A:mounted"
    ]);

    // update
    steps = [];
    c!.state.flag = false;
    await nextTick();
    expect(steps).toEqual([
      "C:render",
      "D:willUpdateProps",
      "F:constructor",
      "F:willStart",
      "D:render",
      "F:render",
      "C:willPatch",
      "D:willPatch",
      "F:__patch",
      "D:__patch",
      "C:__patch",
      "E:willUnmount",
      "E:destroy",
      "F:mounted",
      "D:patched",
      "C:patched"
    ]);
  });

  test("can inject values in tagged templates", async () => {
    const SUBTEMPLATE = xml`<span><t t-esc="state.n"/></span>`;
    class Parent extends Component<any, any> {
      static template = xml`<div><t t-call="${SUBTEMPLATE}"/></div>`;
      state = useState({ n: 42 });
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
    expect(fixture.innerHTML).toBe("<div><span>42</span></div>");
  });
});

describe("async rendering", () => {
  test("destroying a widget before start is over", async () => {
    let def = makeDeferred();
    class W extends Component<any, any> {
      static template = xml`<div/>`;
      willStart(): Promise<void> {
        return def;
      }
    }
    const w = new W();
    w.mount(fixture);
    expect(w.__owl__.isDestroyed).toBe(false);
    expect(w.__owl__.isMounted).toBe(false);
    w.destroy();
    def.resolve();
    await nextTick();
    expect(w.__owl__.isDestroyed).toBe(true);
    expect(w.__owl__.isMounted).toBe(false);
  });

  test("destroying/recreating a subwidget with different props (if start is not over)", async () => {
    let def = makeDeferred();
    let n = 0;
    class Child extends Component<any, any> {
      static template = xml`<span>child:<t t-esc="props.val"/></span>`;
      constructor(parent, props) {
        super(parent, props);
        n++;
      }
      willStart(): Promise<void> {
        return def;
      }
    }
    class W extends Component<any, any> {
      static template = xml`<div><t t-if="state.val > 1"><Child val="state.val"/></t></div>`;
      static components = { Child };
      state = useState({ val: 1 });
    }

    const w = new W();
    await w.mount(fixture);
    expect(n).toBe(0);
    w.state.val = 2;

    await nextMicroTick();
    expect(n).toBe(1);
    w.state.val = 3;
    await nextMicroTick();
    expect(n).toBe(2);
    def.resolve();
    await nextTick();
    expect(children(w).length).toBe(1);
    expect(fixture.innerHTML).toBe("<div><span>child:3</span></div>");
  });

  test("creating two async components, scenario 1", async () => {
    let defA = makeDeferred();
    let defB = makeDeferred();
    let nbRenderings: number = 0;

    class ChildA extends Component<any, any> {
      static template = xml`<span><t t-esc="getValue()"/></span>`;
      willStart(): Promise<void> {
        return defA;
      }
      getValue() {
        nbRenderings++;
        return "a";
      }
    }

    class ChildB extends Component<any, any> {
      static template = xml`<span>b</span>`;
      willStart(): Promise<void> {
        return defB;
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.flagA"><ChildA /></t>
          <t t-if="state.flagB"><ChildB /></t>
        </div>`;
      static components = { ChildA, ChildB };
      state = useState({ flagA: false, flagB: false });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div></div>");
    parent.state.flagA = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");
    parent.state.flagB = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");
    defB.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");
    expect(nbRenderings).toBe(0);
    defA.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a</span><span>b</span></div>");
    expect(nbRenderings).toBe(1);
  });

  test("creating two async components, scenario 2", async () => {
    let defA = makeDeferred();
    let defB = makeDeferred();

    class ChildA extends Component<any, any> {
      static template = xml`<span>a<t t-esc="props.val"/></span>`;
      willUpdateProps(): Promise<void> {
        return defA;
      }
    }
    class ChildB extends Component<any, any> {
      static template = xml`<span>b<t t-esc="props.val"/></span>`;
      willStart(): Promise<void> {
        return defB;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <ChildA val="state.valA"/>
          <t t-if="state.flagB"><ChildB val="state.valB"/></t>
        </div>`;
      static components = { ChildA, ChildB };
      state = useState({ valA: 1, valB: 2, flagB: false });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    parent.state.valA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    parent.state.flagB = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    defB.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    defA.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a2</span><span>b2</span></div>");
  });

  test("creating two async components, scenario 3 (patching in the same frame)", async () => {
    let defA = makeDeferred();
    let defB = makeDeferred();

    class ChildA extends Component<any, any> {
      static template = xml`<span>a<t t-esc="props.val"/></span>`;
      willUpdateProps(): Promise<void> {
        return defA;
      }
    }
    class ChildB extends Component<any, any> {
      static template = xml`<span>b<t t-esc="props.val"/></span>`;
      willStart(): Promise<void> {
        return defB;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <ChildA val="state.valA"/>
          <t t-if="state.flagB"><ChildB val="state.valB"/></t>
        </div>`;
      static components = { ChildA, ChildB };
      state = useState({ valA: 1, valB: 2, flagB: false });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    parent.state.valA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    parent.state.flagB = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    defB.resolve();
    expect(fixture.innerHTML).toBe("<div><span>a1</span></div>");
    defA.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>a2</span><span>b2</span></div>");
  });

  test("update a sub-component twice in the same frame", async () => {
    const steps: string[] = [];
    const defs = [makeDeferred(), makeDeferred()];
    let index = 0;
    class ChildA extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
      willUpdateProps(): Promise<void> {
        return defs[index++];
      }
      patched() {
        steps.push("patched");
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><ChildA val="state.valA"/></div>`;
      static components = { ChildA };
      state = useState({ valA: 1 });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    parent.state.valA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    parent.state.valA = 3;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    defs[0].resolve();
    await Promise.resolve();
    defs[1].resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>3</span></div>");
    expect(steps).toEqual(["patched"]);
  });

  test("update a sub-component twice in the same frame, 2", async () => {
    const steps: string[] = [];
    class ChildA extends Component<any, any> {
      static template = xml`<span><t t-esc="val()"/></span>`;
      patched() {
        steps.push("patched");
      }
      val() {
        steps.push("render");
        return this.props.val;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><ChildA val="state.valA"/></div>`;
      static components = { ChildA };
      state = useState({ valA: 1 });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    parent.state.valA = 2;
    await nextMicroTick();
    expect(steps).toEqual(["render"]);
    await nextMicroTick();
    // For an unknown reason, this test fails on windows without the next microtick. It works
    // in linux and osx, but fails on at least this machine.
    // I do not see anything harmful in waiting an extra tick. But it is annoying to not
    // know what is different.
    await nextMicroTick();
    expect(steps).toEqual(["render", "render"]);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    parent.state.valA = 3;
    await nextMicroTick();
    expect(steps).toEqual(["render", "render"]);
    await nextMicroTick();
    // same as above
    await nextMicroTick();
    expect(steps).toEqual(["render", "render", "render"]);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>3</span></div>");
    expect(steps).toEqual(["render", "render", "render", "patched"]);
  });

  test("components in a node in a t-foreach ", async () => {
    class Child extends Component<any, any> {}

    class App extends Component<any, any> {
      static components = { Child };

      get items() {
        return [1, 2];
      }
    }
    env.qweb.addTemplates(`
        <templates>
            <div t-name="Child"><t t-esc="props.item"/></div>
            <div t-name="App">
                <ul>
                    <t t-foreach="items" t-as="item">
                        <li t-key="'li_'+item">
                            <Child item="item"/>
                        </li>
                    </t>
                </ul>
            </div>
        </templates>`);

    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe(
      "<div><ul><li><div>1</div></li><li><div>2</div></li></ul></div>"
    );
  });

  test("properly behave when destroyed/unmounted while rendering ", async () => {
    const def = makeDeferred();

    class SubChild extends Component<any, any> {
      static template = xml`<div/>`;
      willPatch() {
        throw new Error("Should not happen!");
      }
      patched() {
        throw new Error("Should not happen!");
      }
      willUpdateProps() {
        return def;
      }
    }

    class Child extends Component<any, any> {
      static template = xml`<div><SubChild /></div>`;
      static components = { SubChild };
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><t t-if="state.flag"><Child val="state.val"/></t></div>`;
      static components = { Child };
      state = useState({ flag: true, val: "Framboise Lindemans" });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div><div></div></div></div>");

    // this change triggers a rendering of the parent. This rendering is delayed,
    // because child is now waiting for def to be resolved
    parent.state.val = "Framboise Girardin";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div><div></div></div></div>");

    // with this, we remove child, and subchild, even though it is not finished
    // rendering from previous changes
    parent.state.flag = false;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");

    // we now resolve def, so the child rendering is now complete.
    (<any>def).resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div></div>");
  });

  test.skip("reuse widget if possible, in some async situation", async () => {
    // this optimization has been temporarily deactivated
    env.qweb.addTemplates(`
        <templates>
            <span t-name="ChildA">a<t t-esc="props.val"/></span>
            <span t-name="ChildB">b<t t-esc="props.val"/></span>
            <span t-name="Parent">
                <t t-if="state.flag">
                    <ChildA val="state.valA"/>
                    <ChildB val="state.valB"/>
                </t>
            </span>
        </templates>
    `);

    let destroyCount = 0;
    class ChildA extends Component<any, any> {
      destroy() {
        destroyCount++;
        super.destroy();
      }
    }
    class ChildB extends Component<any, any> {
      willStart(): any {
        return new Promise(function() {});
      }
    }
    class Parent extends Component<any, any> {
      static components = { ChildA, ChildB };
      state = useState({ valA: 1, valB: 2, flag: false });
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(destroyCount).toBe(0);

    parent.state.flag = true;
    await nextTick();
    expect(destroyCount).toBe(0);

    parent.state.valB = 3;
    await nextTick();
    expect(destroyCount).toBe(0);
  });

  test("rendering component again in next microtick", async () => {
    class Child extends Component<any, any> {
      static template = xml`<div t-name="Child">Child</div>`;
    }

    class App extends Component<any, any> {
      static template = xml`
        <div>
          <button t-on-click="onClick">Click</button>
          <t t-if="env.flag"><Child/></t>
        </div>`;
      static components = { Child };

      async onClick() {
        (env as any).flag = true;
        this.render();
        await Promise.resolve();
        this.render();
      }
    }

    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><button>Click</button></div>");
    fixture.querySelector("button")!.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><button>Click</button><div>Child</div></div>");
  });

  test("concurrent renderings scenario 1", async () => {
    const def = makeDeferred();
    let stateB;

    class ComponentC extends Component<any, any> {
      static template = xml`<span><t t-esc="props.fromA"/><t t-esc="someValue()"/></span>`;
      someValue() {
        return this.props.fromB;
      }
      willUpdateProps() {
        return def;
      }
    }
    ComponentC.prototype.someValue = jest.fn(ComponentC.prototype.someValue);

    class ComponentB extends Component<any, any> {
      static components = { ComponentC };
      static template = xml`<p><ComponentC fromA="props.fromA" fromB="state.fromB" /></p>`;
      state = useState({ fromB: "b" });

      constructor(parent, props) {
        super(parent, props);
        stateB = this.state;
      }
    }

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    stateB.fromB = "c";
    await nextTick();

    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    expect(ComponentC.prototype.someValue).toBeCalledTimes(1);
    def.resolve();
    await nextTick();

    expect(ComponentC.prototype.someValue).toBeCalledTimes(2);
    expect(fixture.innerHTML).toBe("<div><p><span>2c</span></p></div>");
  });

  test("concurrent renderings scenario 2", async () => {
    // this test asserts that a rendering initiated before another one, and that
    // ends after it, is re-mapped to that second rendering
    const defs = [makeDeferred(), makeDeferred()];
    let index = 0;
    let stateB;
    class ComponentC extends Component<any, any> {
      static template = xml`<span><t t-esc="props.fromA"/><t t-esc="props.fromB"/></span>`;
      willUpdateProps() {
        return defs[index++];
      }
    }

    class ComponentB extends Component<any, any> {
      static template = xml`<p><ComponentC fromA="props.fromA" fromB="state.fromB" /></p>`;
      static components = { ComponentC };
      state = useState({ fromB: "b" });

      constructor(parent, props) {
        super(parent, props);
        stateB = this.state;
      }
    }

    class ComponentA extends Component<any, any> {
      static template = xml`<div><t t-esc="state.fromA"/><ComponentB fromA="state.fromA"/></div>`;
      static components = { ComponentB };
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>1<p><span>1b</span></p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>1<p><span>1b</span></p></div>");

    stateB.fromB = "c";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>1<p><span>1b</span></p></div>");

    defs[1].resolve(); // resolve rendering initiated in B
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>2<p><span>2c</span></p></div>");

    defs[0].resolve(); // resolve rendering initiated in A
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>2<p><span>2c</span></p></div>");
  });

  test("concurrent renderings scenario 2bis", async () => {
    const defs = [makeDeferred(), makeDeferred()];
    let index = 0;
    let stateB;
    class ComponentC extends Component<any, any> {
      static template = xml`<span><t t-esc="props.fromA"/><t t-esc="props.fromB"/></span>`;
      willUpdateProps() {
        return defs[index++];
      }
    }

    class ComponentB extends Component<any, any> {
      static template = xml`<p><ComponentC fromA="props.fromA" fromB="state.fromB" /></p>`;
      static components = { ComponentC };
      state = useState({ fromB: "b" });

      constructor(parent, props) {
        super(parent, props);
        stateB = this.state;
      }
    }

    class ComponentA extends Component<any, any> {
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      static components = { ComponentB };
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    stateB.fromB = "c";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>");

    defs[0].resolve(); // resolve rendering initiated in A
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>1b</span></p></div>"); // TODO: is this what we want?? 2b could be ok too

    defs[1].resolve(); // resolve rendering initiated in B
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>2c</span></p></div>");
  });

  test("concurrent renderings scenario 3", async () => {
    const defB = makeDeferred();
    const defsD = [makeDeferred(), makeDeferred()];
    let index = 0;
    let stateC;

    class ComponentD extends Component<any, any> {
      static template = xml`<i><t t-esc="props.fromA"/><t t-esc="someValue()"/></i>`;
      someValue() {
        return this.props.fromC;
      }
      willUpdateProps() {
        return defsD[index++];
      }
    }
    ComponentD.prototype.someValue = jest.fn(ComponentD.prototype.someValue);

    class ComponentC extends Component<any, any> {
      static template = xml`<span><ComponentD fromA="props.fromA" fromC="state.fromC" /></span>`;
      static components = { ComponentD };
      state = useState({ fromC: "c" });
      constructor(parent, props) {
        super(parent, props);
        stateC = this.state;
      }
    }

    class ComponentB extends Component<any, any> {
      static template = xml`<p><ComponentC fromA="props.fromA" /></p>`;
      static components = { ComponentC };

      willUpdateProps() {
        return defB;
      }
    }

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    stateC.fromC = "d";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    defB.resolve(); // resolve rendering initiated in A (still blocked in D)
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    defsD[0].resolve(); // resolve rendering initiated in C (should be ignored)
    await nextTick();
    expect(ComponentD.prototype.someValue).toBeCalledTimes(1);
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    defsD[1].resolve(); // completely resolve rendering initiated in A
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>2d</i></span></p></div>");
    expect(ComponentD.prototype.someValue).toBeCalledTimes(2);
  });

  test("concurrent renderings scenario 4", async () => {
    const defB = makeDeferred();
    const defsD = [makeDeferred(), makeDeferred()];
    let index = 0;
    let stateC;

    class ComponentD extends Component<any, any> {
      static template = xml`<i><t t-esc="props.fromA"/><t t-esc="someValue()"/></i>`;
      someValue() {
        return this.props.fromC;
      }
      willUpdateProps() {
        return defsD[index++];
      }
    }
    ComponentD.prototype.someValue = jest.fn(ComponentD.prototype.someValue);

    class ComponentC extends Component<any, any> {
      static template = xml`<span><ComponentD fromA="props.fromA" fromC="state.fromC" /></span>`;
      static components = { ComponentD };
      state = useState({ fromC: "c" });
      constructor(parent, props) {
        super(parent, props);
        stateC = this.state;
      }
    }

    class ComponentB extends Component<any, any> {
      static template = xml`<p><ComponentC fromA="props.fromA" /></p>`;
      static components = { ComponentC };

      willUpdateProps() {
        return defB;
      }
    }

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    stateC.fromC = "d";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    defB.resolve(); // resolve rendering initiated in A (still blocked in D)
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>1c</i></span></p></div>");

    defsD[1].resolve(); // completely resolve rendering initiated in A
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>2d</i></span></p></div>");
    expect(ComponentD.prototype.someValue).toBeCalledTimes(2);

    defsD[0].resolve(); // resolve rendering initiated in C (should be ignored)
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span><i>2d</i></span></p></div>");
    expect(ComponentD.prototype.someValue).toBeCalledTimes(2);
  });

  test("concurrent renderings scenario 5", async () => {
    const defsB = [makeDeferred(), makeDeferred()];
    let index = 0;

    class ComponentB extends Component<any, any> {
      static template = xml`<p><t t-esc="someValue()" /></p>`;
      someValue() {
        return this.props.fromA;
      }
      willUpdateProps() {
        return defsB[index++];
      }
    }
    ComponentB.prototype.someValue = jest.fn(ComponentB.prototype.someValue);

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    component.state.fromA = 3;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    defsB[0].resolve(); // resolve first re-rendering (should be ignored)
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(1);

    defsB[1].resolve(); // resolve second re-rendering
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>3</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(2);
  });

  test("concurrent renderings scenario 6", async () => {
    const defsB = [makeDeferred(), makeDeferred()];
    let index = 0;

    class ComponentB extends Component<any, any> {
      static template = xml`<p><t t-esc="someValue()" /></p>`;
      someValue() {
        return this.props.fromA;
      }
      willUpdateProps() {
        return defsB[index++];
      }
    }
    ComponentB.prototype.someValue = jest.fn(ComponentB.prototype.someValue);

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    component.state.fromA = 3;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    defsB[1].resolve(); // resolve second re-rendering
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>3</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(2);

    defsB[0].resolve(); // resolve first re-rendering (should be ignored)
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>3</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(2);
  });

  test("concurrent renderings scenario 7", async () => {
    class ComponentB extends Component<any, any> {
      static template = xml`<p><t t-esc="props.fromA" /><t t-esc="someValue()" /></p>`;
      state = useState({ fromB: "b" });
      someValue() {
        return this.state.fromB;
      }
      async willUpdateProps() {
        this.state.fromB = "c";
      }
    }
    ComponentB.prototype.someValue = jest.fn(ComponentB.prototype.someValue);

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>1b</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(1);

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>2c</p></div>");
    expect(ComponentB.prototype.someValue).toBeCalledTimes(2);
  });

  test("concurrent renderings scenario 8", async () => {
    const def = makeDeferred();
    let stateB;
    class ComponentB extends Component<any, any> {
      static template = xml`<p><t t-esc="props.fromA" /><t t-esc="state.fromB" /></p>`;
      state = useState({ fromB: "b" });
      constructor(parent, props) {
        super(parent, props);
        stateB = this.state;
      }
      async willUpdateProps(nextProps) {
        return def;
      }
    }

    class ComponentA extends Component<any, any> {
      static components = { ComponentB };
      static template = xml`<div><ComponentB fromA="state.fromA"/></div>`;
      state = useState({ fromA: 1 });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>1b</p></div>");

    component.state.fromA = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1b</p></div>");

    stateB.fromB = "c";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>1b</p></div>");

    def.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>2c</p></div>");
  });

  test("concurrent renderings scenario 9", async () => {
    // Here is the global idea of this scenario:
    //       A
    //      / \
    //     B   C
    //         |
    //         D
    // A state is updated, triggering a whole re-rendering
    // B is async, and blocked
    // C (and D) are rendered
    // C state is updated, producing a re-rendering of C and D
    // this last re-rendering of C should be correctly re-mapped to the whole
    // re-rendering
    const def = makeDeferred();
    let stateC;
    class ComponentD extends Component<any, any> {
      static template = xml`<span><t t-esc="props.fromA"/><t t-esc="props.fromC"/></span>`;
    }
    class ComponentC extends Component<any, any> {
      static template = xml`<p><ComponentD fromA="props.fromA" fromC="state.fromC" /></p>`;
      static components = { ComponentD };
      state = useState({ fromC: "b1" });

      constructor(parent, props) {
        super(parent, props);
        stateC = this.state;
      }
    }
    class ComponentB extends Component<any, any> {
      static template = xml`<b><t t-esc="props.fromA"/></b>`;
      willUpdateProps() {
        return def;
      }
    }
    class ComponentA extends Component<any, any> {
      static template = xml`
        <div>
          <t t-esc="state.fromA"/>
          <ComponentB fromA="state.fromA"/>
          <ComponentC fromA="state.fromA"/>
        </div>`;
      static components = { ComponentB, ComponentC };
      state = useState({ fromA: "a1" });
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>a1<b>a1</b><p><span>a1b1</span></p></div>");

    component.state.fromA = "a2";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>a1<b>a1</b><p><span>a1b1</span></p></div>");

    stateC.fromC = "b2";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>a1<b>a1</b><p><span>a1b1</span></p></div>");

    def.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>a2<b>a2</b><p><span>a2b2</span></p></div>");
  });

  test("concurrent renderings scenario 10", async () => {
    // Here is the global idea of this scenario:
    //       A
    //       |
    //       B    <- async willUpdateProps
    //     -----  <- conditional (initialy false)
    //       |
    //       C    <- async willStart
    // Render A and B normally
    // Change the condition on B to trigger a re-rendering with C (async willStart)
    // Change the state on A to trigger a global re-rendering, which is blocked
    // in B (async willUpdateProps)
    // Resolve the willStart of C: the first re-rendering has been cancelled by
    // the global re-rendering, but handlers waiting for the rendering promise to
    // resolve might execute and we don't want them to crash/do anything
    const defB = makeDeferred();
    const defC = makeDeferred();
    let stateB;
    class ComponentC extends Component<any, any> {
      static template = xml`<span><t t-esc="props.value"/></span>`;
      willStart() {
        return defC;
      }
    }
    ComponentC.prototype.__render = jest.fn(ComponentC.prototype.__render);
    class ComponentB extends Component<any, any> {
      static template = xml`<p><ComponentC t-if="state.hasChild" value="props.value"/></p>`;
      state = useState({ hasChild: false });
      static components = { ComponentC };
      constructor(parent, props) {
        super(parent, props);
        stateB = this.state;
      }
      willUpdateProps() {
        return defB;
      }
    }
    class ComponentA extends Component<any, any> {
      static template = xml`<div><ComponentB value="state.value"/></div>`;
      static components = { ComponentB };
      state = useState({ value: 1 });
    }

    const componentA = new ComponentA();
    await componentA.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><p></p></div>");
    stateB.hasChild = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p></p></div>");

    componentA.state.value = 2;
    defC.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p></p></div>");

    defB.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p><span>2</span></p></div>");
    expect(ComponentC.prototype.__render).toHaveBeenCalledTimes(1);
  });

  test("concurrent renderings scenario 11", async () => {
    // This scenario is the following: we have a component being updated (by props),
    // and then rendered (render method), but before the willUpdateProps resolves.
    // We check that in that case, the return value of the render method is a promise
    // that is resolved when the component is completely rendered (so, properly
    // remapped to the promise of the ambient rendering)
    const def = makeDeferred();
    let child;
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/>|<t t-esc="val"/></span>`;
      val = 3;
      willUpdateProps() {
        child = this;
        return def;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><Child val="state.valA"/></div>`;
      static components = { Child };
      state = useState({ valA: 1 });
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1|3</span></div>");
    parent.state.valA = 2;

    await nextTick();
    setTimeout(() => {
      def.resolve();
    }, 20);
    child.val = 5;
    await child.render();
    expect(fixture.innerHTML).toBe("<div><span>2|5</span></div>");
  });

  test("concurrent renderings scenario 12", async () => {
    // In this scenario, we have a parent component that will be re-rendered
    // several times simultaneously:
    //    - once in a tick: it will create a new fiber, render it, but will have
    //    to wait for its child (blocking) to be completed
    //    - twice in the next tick: it will twice reuse the same fiber (as it is
    //    rendered but not completed yet)
    const def = makeDeferred();

    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
      willUpdateProps() {
        return def;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`<div><Child val="state.val"/></div>`;
      static components = { Child };
      state = useState({ val: 1 });
    }
    Parent.prototype.__render = jest.fn(Parent.prototype.__render);

    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    expect(Parent.prototype.__render).toHaveBeenCalledTimes(1);

    parent.state.val = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    expect(Parent.prototype.__render).toHaveBeenCalledTimes(2);

    parent.state.val = 3;
    parent.state.val = 4;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    expect(Parent.prototype.__render).toHaveBeenCalledTimes(3);

    def.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>4</span></div>");
    expect(Parent.prototype.__render).toHaveBeenCalledTimes(3);
  });

  test("concurrent renderings scenario 13", async () => {
    let lastChild;
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="state.val"/></span>`;
      state = useState({ val: 0 });
      mounted() {
        if (lastChild) {
          lastChild.state.val = 0;
        }
        lastChild = this;
        this.state.val = 1;
      }
    }

    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <Child/>
          <Child t-if="state.bool"/>
        </div>`;
      static components = { Child };
      state = useState({ bool: false });
    }

    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>0</span></div>");

    await nextTick(); // wait for changes triggered in mounted to be applied
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");

    parent.state.bool = true;
    await nextTick(); // wait for this change to be applied
    await nextTick(); // wait for changes triggered in mounted to be applied
    expect(fixture.innerHTML).toBe("<div><span>0</span><span>1</span></div>");
  });

  test("change state and call manually render: no unnecessary rendering", async () => {
    class Widget extends Component<any, any> {
      static template = xml`<div><t t-esc="state.val"/></div>`;
      state = useState({ val: 1 });
    }
    Widget.prototype.__render = jest.fn(Widget.prototype.__render);

    const widget = new Widget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>1</div>");
    expect(Widget.prototype.__render).toHaveBeenCalledTimes(1);

    widget.state.val = 2;
    await widget.render();
    expect(fixture.innerHTML).toBe("<div>2</div>");
    expect(Widget.prototype.__render).toHaveBeenCalledTimes(2);
  });
});

describe("widget and observable state", () => {
  test("widget is rerendered when its state is changed", async () => {
    class TestWidget extends Component<any, any> {
      static template = xml`<div><t t-esc="state.drink"/></div>`;
      state = useState({ drink: "water" });
    }
    const widget = new TestWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>water</div>");
    widget.state.drink = "beer";

    await nextTick();
    expect(fixture.innerHTML).toBe("<div>beer</div>");
  });

  test("subcomponents cannot change observable state received from parent", async () => {
    const consoleError = console.error;
    console.error = jest.fn();
    env.qweb.addTemplate("Parent", `<div><Child obj="state.obj"/></div>`);
    class Child extends Component<any, any> {
      static template = xml`<div/>`;
      constructor(parent, props) {
        super(parent, props);
        props.obj.coffee = 2;
      }
    }
    class Parent extends Component<any, any> {
      state = useState({ obj: { coffee: 1 } });
      static components = { Child };
    }
    const parent = new Parent();
    let error;
    try {
      await parent.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe('Observed state cannot be changed here! (key: "coffee", val: "2")');
    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });
});

describe("can deduce template from name", () => {
  test("can find template if name of component", async () => {
    class ABC extends Component<any, any> {}
    env.qweb.addTemplate("ABC", "<span>Orval</span>");
    const abc = new ABC();
    await abc.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>Orval</span>");
  });

  test("can find template of parent component", async () => {
    class ABC extends Component<any, any> {}
    class DEF extends ABC {}
    env.qweb.addTemplate("ABC", "<span>Orval</span>");
    const def = new DEF();
    await def.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>Orval</span>");
  });

  test("can find template of parent component, defined by template key", async () => {
    class ABC extends Component<any, any> {
      static template = "Achel";
    }
    class DEF extends ABC {}
    env.qweb.addTemplate("Achel", "<span>Orval</span>");
    const def = new DEF();
    await def.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>Orval</span>");
  });

  test("templates are found in proper qweb instance", async () => {
    const env2 = makeTestEnv();
    env.qweb.addTemplate("ABC", "<span>Rochefort 8</span>");
    env2.qweb.addTemplate("ABC", "<span>Rochefort 10</span>");
    class ABC extends Component<any, any> {}
    const abc = new ABC();
    await abc.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>Rochefort 8</span>");
    abc.destroy();
    Component.env = env2;
    const abc2 = new ABC();
    await abc2.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>Rochefort 10</span>");
  });
});

describe("t-model directive", () => {
  test("basic use, on an input", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
          <input t-model="state.text"/>
          <span><t t-esc="state.text"/></span>
        </div>`;
      state = useState({ text: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><input><span></span></div>");

    const input = fixture.querySelector("input")!;
    await editInput(input, "test");
    expect(comp.state.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><input><span>test</span></div>");
    expect(env.qweb.templates[SomeComponent.template].fn.toString()).toMatchSnapshot();
  });

  test("basic use, on another key in component", async () => {
    env.qweb.addTemplates(`
    <templates>
        <div t-name="SomeComponent">
            <input t-model="some.text"/>
            <span><t t-esc="some.text"/></span>
        </div>
    </templates>`);
    class SomeComponent extends Component<any, any> {
      some = useState({ text: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><input><span></span></div>");

    const input = fixture.querySelector("input")!;
    await editInput(input, "test");
    expect(comp.some.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><input><span>test</span></div>");
    expect(env.qweb.templates.SomeComponent.fn.toString()).toMatchSnapshot();
  });

  test("on an input, type=checkbox", async () => {
    env.qweb.addTemplates(`
    <templates>
        <div t-name="SomeComponent">
            <input type="checkbox" t-model="state.flag"/>
            <span>
                <t t-if="state.flag">yes</t>
                <t t-else="">no</t>
            </span>
        </div>
    </templates>`);
    class SomeComponent extends Component<any, any> {
      state = useState({ flag: false });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe('<div><input type="checkbox"><span>no</span></div>');

    let input = fixture.querySelector("input")!;
    input.click();
    await nextTick();
    expect(fixture.innerHTML).toBe('<div><input type="checkbox"><span>yes</span></div>');
    expect(comp.state.flag).toBe(true);
    expect(env.qweb.templates.SomeComponent.fn.toString()).toMatchSnapshot();

    input.click();
    await nextTick();
    expect(comp.state.flag).toBe(false);
  });

  test("on an textarea", async () => {
    env.qweb.addTemplates(`
    <templates>
        <div t-name="SomeComponent">
            <textarea t-model="state.text"/>
            <span><t t-esc="state.text"/></span>
        </div>
    </templates>`);
    class SomeComponent extends Component<any, any> {
      state = useState({ text: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><textarea></textarea><span></span></div>");

    const textarea = fixture.querySelector("textarea")!;
    await editInput(textarea, "test");
    expect(comp.state.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><textarea></textarea><span>test</span></div>");
  });

  test("on an input type=radio", async () => {
    env.qweb.addTemplates(`
    <templates>
        <div t-name="SomeComponent">
            <input type="radio" id="one" value="One" t-model="state.choice"/>
            <input type="radio" id="two" value="Two" t-model="state.choice"/>
            <span>Choice: <t t-esc="state.choice"/></span>
        </div>
    </templates>`);
    class SomeComponent extends Component<any, any> {
      state = useState({ choice: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe(
      '<div><input type="radio" id="one" value="One"><input type="radio" id="two" value="Two"><span>Choice: </span></div>'
    );

    const firstInput = fixture.querySelector("input")!;
    firstInput.click();
    await nextTick();
    expect(comp.state.choice).toBe("One");
    expect(fixture.innerHTML).toBe(
      '<div><input type="radio" id="one" value="One"><input type="radio" id="two" value="Two"><span>Choice: One</span></div>'
    );

    const secondInput = fixture.querySelectorAll("input")[1];
    secondInput.click();
    await nextTick();
    expect(comp.state.choice).toBe("Two");
    expect(fixture.innerHTML).toBe(
      '<div><input type="radio" id="one" value="One"><input type="radio" id="two" value="Two"><span>Choice: Two</span></div>'
    );
    expect(env.qweb.templates.SomeComponent.fn.toString()).toMatchSnapshot();
  });

  test("on a select", async () => {
    env.qweb.addTemplates(`
    <templates>
        <div t-name="SomeComponent">
            <select t-model="state.color">
                <option value="">Please select one</option>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
            </select>
            <span>Choice: <t t-esc="state.color"/></span>
        </div>
    </templates>`);
    class SomeComponent extends Component<any, any> {
      state = useState({ color: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe(
      '<div><select><option value="">Please select one</option><option value="red">Red</option><option value="blue">Blue</option></select><span>Choice: </span></div>'
    );

    const select = fixture.querySelector("select")!;
    select.value = "red";
    select.dispatchEvent(new Event("change"));
    await nextTick();

    expect(comp.state.color).toBe("red");
    expect(fixture.innerHTML).toBe(
      '<div><select><option value="">Please select one</option><option value="red">Red</option><option value="blue">Blue</option></select><span>Choice: red</span></div>'
    );

    expect(env.qweb.templates.SomeComponent.fn.toString()).toMatchSnapshot();
  });

  test("on a select, initial state", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
          <select t-model="state.color">
            <option value="">Please select one</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
          </select>
        </div>
      `;
      state = useState({ color: "red" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);
    const select = fixture.querySelector("select")!;
    expect(select.value).toBe("red");
  });

  test("on a sub state key", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
          <input t-model="state.something.text"/>
          <span><t t-esc="state.something.text"/></span>
        </div>
      `;
      state = useState({ something: { text: "" } });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><input><span></span></div>");

    const input = fixture.querySelector("input")!;
    await editInput(input, "test");
    expect(comp.state.something.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><input><span>test</span></div>");
    expect(env.qweb.templates[SomeComponent.template].fn.toString()).toMatchSnapshot();
  });

  test(".lazy modifier", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
            <input t-model.lazy="state.text"/>
            <span><t t-esc="state.text"/></span>
        </div>
      `;
      state = useState({ text: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><input><span></span></div>");

    const input = fixture.querySelector("input")!;
    input.value = "test";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(comp.state.text).toBe("");
    expect(fixture.innerHTML).toBe("<div><input><span></span></div>");
    input.dispatchEvent(new Event("change"));
    await nextTick();
    expect(comp.state.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><input><span>test</span></div>");
    expect(env.qweb.templates[SomeComponent.template].fn.toString()).toMatchSnapshot();
  });

  test(".trim modifier", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div t-name="SomeComponent">
          <input t-model.trim="state.text"/>
          <span><t t-esc="state.text"/></span>
        </div>
      `;
      state = useState({ text: "" });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);

    const input = fixture.querySelector("input")!;
    await editInput(input, " test ");
    expect(comp.state.text).toBe("test");
    expect(fixture.innerHTML).toBe("<div><input><span>test</span></div>");
  });

  test(".number modifier", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
          <input t-model.number="state.number"/>
          <span><t t-esc="state.number"/></span>
        </div>
      `;
      state = useState({ number: 0 });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><input><span>0</span></div>");

    const input = fixture.querySelector("input")!;
    await editInput(input, "13");
    expect(comp.state.number).toBe(13);
    expect(fixture.innerHTML).toBe("<div><input><span>13</span></div>");

    await editInput(input, "invalid");
    expect(comp.state.number).toBe("invalid");
    expect(fixture.innerHTML).toBe("<div><input><span>invalid</span></div>");
  });

  test("in a t-foreach", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div>
          <t t-foreach="state" t-as="thing" t-key="thing.id">
            <input type="checkbox" t-model="thing.f"/>
          </t>
        </div>
      `;
      state = useState([
        { f: false, id: 1 },
        { f: false, id: 2 },
        { f: false, id: 3 }
      ]);
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);
    expect(fixture.innerHTML).toBe(
      '<div><input type="checkbox"><input type="checkbox"><input type="checkbox"></div>'
    );

    const input = fixture.querySelectorAll("input")[1]!;
    input.click();
    expect(comp.state[1].f).toBe(true);
    expect(comp.state[0].f).toBe(false);
    expect(comp.state[2].f).toBe(false);
    expect(env.qweb.templates[SomeComponent.template].fn.toString()).toMatchSnapshot();
  });

  test("two inputs in a div with a t-key", async () => {
    class SomeComponent extends Component<any, any> {
      static template = xml`
        <div t-key="'key'">
          <input class="a" t-if="state.flag"/>
          <input class="b" t-if="!state.flag"/>
        </div>
      `;
      state = useState({ flag: true });
    }
    const comp = new SomeComponent();
    await comp.mount(fixture);
    expect(fixture.innerHTML).toBe('<div><input class="a"></div>');
    expect(env.qweb.templates[SomeComponent.template].fn.toString()).toMatchSnapshot();
    fixture.querySelector("input")!.value = "asdf";
    expect(fixture.querySelector("input")!.value).toBe("asdf");
    comp.state.flag = false;
    await nextTick();
    expect(fixture.innerHTML).toBe('<div><input class="b"></div>');
    expect(fixture.querySelector("input")!.value).toBe("");
  });
});

describe("environment and plugins", () => {
  // some source of external events
  let bus = new EventBus();

  // definition of a plugin
  const somePlugin = env => {
    env.someFlag = true;
    bus.on("some-event", null, () => {
      env.someFlag = !env.someFlag;
      env.qweb.forceUpdate();
    });
  };

  test("plugin works as expected", async () => {
    somePlugin(env);
    class App extends Component<any, any> {
      static template = xml`
        <div>
            <t t-if="env.someFlag">Red</t>
            <t t-else="">Blue</t>
        </div>
      `;
    }

    const app = new App();
    await app.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>Red</div>");
    bus.trigger("some-event");
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>Blue</div>");
  });

  test("can define specific env for root components", async () => {
    class App1 extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    App1.env = { test: 1 };
    class App2 extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    App2.env = { test: 2 };
    class App1B extends App1 {}
    class App2B extends App2 {}
    App2B.env = { test: 3 };

    const app1 = new App1();
    const app2 = new App2();
    const app1B = new App1B();
    const app2B = new App2B();

    expect(app1.env.qweb).toBeDefined();
    expect(app1.env.test).toBe(1);
    expect(app2.env.test).toBe(2);
    expect(app1B.env.test).toBe(1);
    expect(app2B.env.test).toBe(3);
  });
});

describe("component error handling (catchError)", () => {
  /**
   * This test suite requires often to wait for 3 ticks. Here is why:
   * - First tick is to let the app render and crash.
   * - When we crash, we call the catchError handler in a setTimeout (because we
   *   need to wait for the previous rendering to be completely stopped). So, we
   *   need to wait for the second tick.
   * - Then, when the handler changes the state, we need to wait for the interface
   *   to be rerendered.
   *  */

  test("can catch an error in a component render function", async () => {
    const consoleError = console.error;
    console.error = jest.fn();
    const handler = jest.fn();
    env.qweb.on("error", null, handler);
    class ErrorComponent extends Component<any, any> {
      static template = xml`<div>hey<t t-esc="props.flag and state.this.will.crash"/></div>`;
    }
    class ErrorBoundary extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.error">Error handled</t>
          <t t-else=""><t t-slot="default" /></t>
        </div>`;
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static template = xml`
        <div>
          <ErrorBoundary><ErrorComponent flag="state.flag"/></ErrorBoundary>
        </div>`;
      state = useState({ flag: false });
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div><div>heyfalse</div></div></div>");
    app.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
    expect(handler).toBeCalledTimes(1);
  });

  test("no component catching error lead to full app destruction", async () => {
    expect.assertions(6);
    const handler = jest.fn();
    env.qweb.on("error", null, handler);
    const consoleError = console.error;
    console.error = jest.fn();

    class ErrorComponent extends Component<any, any> {
      static template = xml`<div>hey<t t-esc="props.flag and state.this.will.crash"/></div>`;
    }

    class App extends Component<any, any> {
      static template = xml`<div><ErrorComponent flag="state.flag"/></div>`;
      static components = { ErrorComponent };
      state = useState({ flag: false });
      async render() {
        try {
          await super.render();
        } catch (e) {
          expect(e.message).toBe("Cannot read property 'this' of undefined");
        }
      }
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>heyfalse</div></div>");
    app.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
    expect(app.__owl__.isDestroyed).toBe(true);
    expect(handler).toBeCalledTimes(1);
  });

  test("can catch an error in the initial call of a component render function (parent mounted)", async () => {
    const handler = jest.fn();
    env.qweb.on("error", null, handler);
    const consoleError = console.error;
    console.error = jest.fn();
    class ErrorComponent extends Component<any, any> {
      static template = xml`<div>hey<t t-esc="state.this.will.crash"/></div>`;
    }
    class ErrorBoundary extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.error">Error handled</t>
          <t t-else=""><t t-slot="default" /></t>
        </div>`;
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static template = xml`
        <div>
            <ErrorBoundary><ErrorComponent /></ErrorBoundary>
        </div>`;
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
    expect(handler).toBeCalledTimes(1);
  });

  test("can catch an error in the initial call of a component render function (parent updated)", async () => {
    const handler = jest.fn();
    env.qweb.on("error", null, handler);
    const consoleError = console.error;
    console.error = jest.fn();
    class ErrorComponent extends Component<any, any> {
      static template = xml`<div>hey<t t-esc="state.this.will.crash"/></div>`;
    }
    class ErrorBoundary extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.error">Error handled</t>
          <t t-else=""><t t-slot="default" /></t>
        </div>`;
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static template = xml`
        <div>
            <ErrorBoundary t-if="state.flag"><ErrorComponent /></ErrorBoundary>
        </div>`;
      state = useState({ flag: false });
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    app.state.flag = true;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
    expect(handler).toBeCalledTimes(1);
  });

  test("can catch an error in the constructor call of a component render function", async () => {
    const handler = jest.fn();
    env.qweb.on("error", null, handler);
    const consoleError = console.error;
    console.error = jest.fn();
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ErrorBoundary">
            <t t-if="state.error">Error handled</t>
            <t t-else=""><t t-slot="default" /></t>
        </div>
        <div t-name="ErrorComponent">Some text</div>
        <div t-name="App">
            <ErrorBoundary><ErrorComponent /></ErrorBoundary>
        </div>
      </templates>`);
    class ErrorComponent extends Component<any, any> {
      constructor(parent) {
        super(parent);
        throw new Error("NOOOOO");
      }
    }
    class ErrorBoundary extends Component<any, any> {
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
    expect(handler).toBeCalledTimes(1);
  });

  test("can catch an error in the willStart call", async () => {
    const consoleError = console.error;
    console.error = jest.fn();
    class ErrorComponent extends Component<any, any> {
      static template = xml`<div t-name="ErrorComponent">Some text</div>`;
      async willStart() {
        // we wait a little bit to be in a different stack frame
        await nextTick();
        throw new Error("NOOOOO");
      }
    }
    class ErrorBoundary extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.error">Error handled</t>
          <t t-else=""><t t-slot="default" /></t>
        </div>`;
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static template = xml`<div><ErrorBoundary><ErrorComponent /></ErrorBoundary></div>`;
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test.skip("can catch an error in the mounted call", async () => {
    // we do not catch error in mounted anymore
    console.error = jest.fn();
    env.qweb.addTemplates(`
      <templates>
        <div t-name="ErrorBoundary">
            <t t-if="state.error">Error handled</t>
            <t t-else=""><t t-slot="default" /></t>
        </div>
        <div t-name="ErrorComponent">Some text</div>
        <div t-name="App">
            <ErrorBoundary><ErrorComponent /></ErrorBoundary>
        </div>
      </templates>`);
    class ErrorComponent extends Component<any, any> {
      mounted() {
        throw new Error("NOOOOO");
      }
    }
    class ErrorBoundary extends Component<any, any> {
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    await nextTick();
    await nextTick();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><div>Error handled</div></div>");
  });

  test.skip("can catch an error in the willPatch call", async () => {
    // we do not catch error in willPatch anymore
    const consoleError = console.error;
    console.error = jest.fn();
    class ErrorComponent extends Component<any, any> {
      static template = xml`<div><t t-esc="props.message"/></div>`;
      willPatch() {
        throw new Error("NOOOOO");
      }
    }
    class ErrorBoundary extends Component<any, any> {
      static template = xml`
        <div>
          <t t-if="state.error">Error handled</t>
          <t t-else=""><t t-slot="default" /></t>
        </div>`;
      state = useState({ error: false });

      catchError() {
        this.state.error = true;
      }
    }
    class App extends Component<any, any> {
      static template = xml`
        <div>
            <span><t t-esc="state.message"/></span>
          <ErrorBoundary><ErrorComponent message="state.message" /></ErrorBoundary>
        </div>`;
      state = useState({ message: "abc" });
      static components = { ErrorBoundary, ErrorComponent };
    }
    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>abc</span><div><div>abc</div></div></div>");
    app.state.message = "def";
    await nextTick();
    await nextTick();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>def</span><div>Error handled</div></div>");
    expect(console.error).toHaveBeenCalledTimes(1);
    console.error = consoleError;
  });

  test("a rendering error will reject the mount promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});
    // we do not catch error in willPatch anymore
    class App extends Component<any, any> {
      static template = xml`<div><t t-esc="this.will.crash"/></div>`;
    }

    const app = new App();
    let error;
    try {
      await app.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot read property 'crash' of undefined");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("an error in mounted call will reject the mount promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});

    class App extends Component<any, any> {
      static template = xml`<div>abc</div>`;
      mounted() {
        throw new Error("boom");
      }
    }

    const app = new App();
    let error;
    try {
      await app.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("boom");
    expect(fixture.innerHTML).toBe("");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("an error in willPatch call will reject the render promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});

    class App extends Component<any, any> {
      static template = xml`<div><t t-esc="val"/></div>`;
      val = 3;
      willPatch() {
        throw new Error("boom");
      }
    }

    const app = new App();
    await app.mount(fixture);
    app.val = 4;
    let error;
    try {
      await app.render();
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("boom");
    expect(fixture.innerHTML).toBe("");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("an error in patched call will reject the render promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});

    class App extends Component<any, any> {
      static template = xml`<div><t t-esc="val"/></div>`;
      val = 3;
      patched() {
        throw new Error("boom");
      }
    }

    const app = new App();
    await app.mount(fixture);
    app.val = 4;
    let error;
    try {
      await app.render();
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("boom");
    expect(fixture.innerHTML).toBe("");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("a rendering error in a sub component will reject the mount promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});
    // we do not catch error in willPatch anymore
    class Child extends Component<any, any> {
      static template = xml`<div><t t-esc="this.will.crash"/></div>`;
    }
    class App extends Component<any, any> {
      static template = xml`<div><Child/></div>`;
      static components = { Child };
    }

    const app = new App();
    let error;
    try {
      await app.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot read property 'crash' of undefined");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("a rendering error will reject the render promise", async () => {
    const consoleError = console.error;
    console.error = jest.fn(() => {});
    // we do not catch error in willPatch anymore
    class App extends Component<any, any> {
      static template = xml`<div><t t-if="flag" t-esc="this.will.crash"/></div>`;
      flag = false;
    }

    const app = new App();
    await app.mount(fixture);
    expect(fixture.innerHTML).toBe("<div></div>");
    app.flag = true;
    let error;
    try {
      await app.render();
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot read property 'crash' of undefined");

    expect(console.error).toBeCalledTimes(0);
    console.error = consoleError;
  });

  test("a rendering error will reject the render promise (with sub components)", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span></span>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`<div><Child/><t t-esc="x.y"/></div>`;
      static components = { Child };
    }

    let error;
    try {
      const parent = new Parent();
      await parent.mount(fixture);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error.message).toBe("Cannot read property 'y' of undefined");
  });
});

describe("top level sub widgets", () => {
  test("basic use", async () => {
    env.qweb.addTemplates(`
        <templates>
          <t t-name="Parent">
            <Child p="1"/>
          </t>
          <span t-name="Child">child<t t-esc="props.p"/></span>
        </templates>`);
    class Child extends Component<any, any> {}
    class Parent extends Component<any, any> {
      static components = { Child };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>child1</span>");
    expect(env.qweb.templates.Parent.fn.toString()).toMatchSnapshot();
  });

  test("sub widget is interactive", async () => {
    env.qweb.addTemplates(`
        <templates>
          <t t-name="Parent">
            <Child p="1"/>
          </t>
          <span t-name="Child"><button t-on-click="inc">click</button>child<t t-esc="state.val"/></span>
        </templates>`);
    class Child extends Component<any, any> {
      state = useState({ val: 1 });
      inc() {
        this.state.val++;
      }
    }
    class Parent extends Component<any, any> {
      static components = { Child };
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<span><button>click</button>child1</span>");
    const button = fixture.querySelector("button")!;
    button.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<span><button>click</button>child2</span>");
  });

  test("can select a sub widget ", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span>CHILD 1</span>`;
    }
    class OtherChild extends Component<any, any> {
      static template = xml`<div>CHILD 2</div>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <t>
          <t t-if="env.flag"><Child /></t>
          <t t-if="!env.flag"><OtherChild /></t>
        </t>
      `;
      static components = { Child, OtherChild };
    }
    (<any>env).flag = true;
    let parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>CHILD 1</span>");
    parent.destroy();
    (<any>env).flag = false;
    parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>CHILD 2</div>");

    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
  });

  test("can select a sub widget, part 2", async () => {
    class Child extends Component<any, any> {
      static template = xml`<span>CHILD 1</span>`;
    }
    class OtherChild extends Component<any, any> {
      static template = xml`<div>CHILD 2</div>`;
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <t>
          <t t-if="state.flag"><Child /></t>
          <t t-if="!state.flag"><OtherChild /></t>
        </t>
      `;
      state = useState({ flag: true });
      static components = { Child, OtherChild };
    }
    let parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<span>CHILD 1</span>");
    parent.state.flag = false;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div>CHILD 2</div>");
  });

  test("top level sub widget with a parent", async () => {
    class ComponentC extends Component<any, any> {
      static template = xml`<span>Hello</span>`;
    }
    class ComponentB extends Component<any, any> {
      static template = xml`<ComponentC />`;
      static components = { ComponentC };
    }
    class ComponentA extends Component<any, any> {
      static template = xml`<div><ComponentB/></div>`;
      static components = { ComponentB };
    }

    const component = new ComponentA();
    await component.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>Hello</span></div>");
  });
});

describe("unmounting and remounting", () => {
  test("widget can be unmounted and remounted", async () => {
    const steps: string[] = [];
    class MyWidget extends Component<any, any> {
      static template = xml`<div>Hey</div>`;
      async willStart() {
        steps.push("willstart");
      }
      mounted() {
        steps.push("mounted");
      }
      willUnmount() {
        steps.push("willunmount");
      }
      patched() {
        throw new Error("patched should not be called");
      }
    }

    const w = new MyWidget();
    await w.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>Hey</div>");
    expect(steps).toEqual(["willstart", "mounted"]);

    w.unmount();
    expect(fixture.innerHTML).toBe("");
    expect(steps).toEqual(["willstart", "mounted", "willunmount"]);

    await w.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>Hey</div>");
    expect(steps).toEqual(["willstart", "mounted", "willunmount", "mounted"]);
  });

  test("widget can be mounted twice without ill effect", async () => {
    const steps: string[] = [];
    class MyWidget extends Component<any, any> {
      static template = xml`<div>Hey</div>`;
      async willStart() {
        steps.push("willstart");
      }
      mounted() {
        steps.push("mounted");
      }
      willUnmount() {
        steps.push("willunmount");
      }
    }

    const w = new MyWidget();
    await w.mount(fixture);
    await w.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>Hey</div>");
    expect(steps).toEqual(["willstart", "mounted"]);
  });

  test("state changes in willUnmount do not trigger rerender", async () => {
    const steps: string[] = [];

    class Child extends Component<any, any> {
      static template = xml`
        <span><t t-esc="props.val"/><t t-esc="state.n"/></span>
      `;
      state = useState({ n: 2 });
      __render(f) {
        steps.push("render");
        return super.__render(f);
      }
      willPatch() {
        steps.push("willPatch");
      }
      patched() {
        steps.push("patched");
      }

      willUnmount() {
        steps.push("willUnmount");
        this.state.n = 3;
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div>
          <Child t-if="state.flag" val="state.val"/>
        </div>
      `;
      static components = { Child };
      state = useState({ val: 1, flag: true });
    }

    const widget = new Parent();
    await widget.mount(fixture);
    expect(steps).toEqual(["render"]);
    expect(fixture.innerHTML).toBe("<div><span>12</span></div>");
    widget.state.flag = false;
    await nextTick();
    // we make sure here that no call to __render is done
    expect(steps).toEqual(["render", "willUnmount"]);
  });

  test("state changes in willUnmount will be applied on remount", async () => {
    class TestWidget extends Component<any, any> {
      static template = xml`
        <div><t t-esc="state.val"/></div>
      `;
      state = useState({ val: 1 });
      willUnmount() {
        this.state.val = 3;
      }
    }

    const widget = new TestWidget();
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>1</div>");
    widget.unmount();
    expect(fixture.innerHTML).toBe("");
    await nextTick(); // wait for changes to be detected before remounting
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>3</div>");
    // we want to make sure that there are no remaining tasks left at this point.
    expect(Component.scheduler.tasks.length).toBe(0);
  });

  test("sub component is still active after being unmounted and remounted", async () => {
    class Child extends Component<any, any> {
      static template = xml`
        <p t-on-click="state.value++">
          <t t-esc="state.value"/>
        </p>`;

      state = useState({ value: 1 });
    }

    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<div><Child/></div>`;
    }

    const w = new Parent();
    await w.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><p>1</p></div>");

    fixture.querySelector("p")!.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>2</p></div>");
    w.unmount();
    await nextTick();
    await w.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><p>2</p></div>");
    fixture.querySelector("p")!.click();
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><p>3</p></div>");
  });

  test("change state just before mounting component", async () => {
    const steps: number[] = [];
    class TestWidget extends Component<any, any> {
      static template = xml`
        <div><t t-esc="state.val"/></div>
      `;
      state = useState({ val: 1 });
      __render(f) {
        steps.push(this.state.val);
        return super.__render(f);
      }
    }
    TestWidget.prototype.__render = jest.fn(TestWidget.prototype.__render);

    const widget = new TestWidget();
    widget.state.val = 2;
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>2</div>");
    expect(TestWidget.prototype.__render).toHaveBeenCalledTimes(1);

    // unmount and re-mount, as in this case, willStart won't be called, so it's
    // slightly different
    widget.unmount();
    widget.state.val = 3;
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>3</div>");
    expect(TestWidget.prototype.__render).toHaveBeenCalledTimes(2);
    expect(steps).toEqual([2, 3]);
  });

  test("change state while mounting component", async () => {
    const steps: number[] = [];
    class TestWidget extends Component<any, any> {
      static template = xml`
        <div><t t-esc="state.val"/></div>
      `;
      state = useState({ val: 1 });
      __render(f) {
        steps.push(this.state.val);
        return super.__render(f);
      }
    }
    TestWidget.prototype.__render = jest.fn(TestWidget.prototype.__render);
    TestWidget.prototype.__patch = jest.fn(TestWidget.prototype.__patch);

    const widget = new TestWidget();
    let prom = widget.mount(fixture);
    widget.state.val = 2;
    await prom;
    expect(fixture.innerHTML).toBe("<div>2</div>");
    expect(TestWidget.prototype.__render).toHaveBeenCalledTimes(1);

    // unmount and re-mount, as in this case, willStart won't be called, so it's
    // slightly different
    widget.unmount();
    prom = widget.mount(fixture);
    widget.state.val = 3;
    await prom;
    expect(fixture.innerHTML).toBe("<div>3</div>");
    expect(TestWidget.prototype.__render).toHaveBeenCalledTimes(3);
    expect(TestWidget.prototype.__patch).toHaveBeenCalledTimes(2);
    expect(steps).toEqual([2, 2, 3]);
  });

  test("change state while component is unmounted", async () => {
    let child;
    class Child extends Component<any, any> {
      static template = xml`<span t-esc="state.val"/>`;
      state = useState({
        val: "C1"
      });
      constructor(parent, props) {
        super(parent, props);
        child = this;
      }
    }

    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<div><t t-esc="state.val"/><Child/></div>`;
      state = useState({ val: "P1" });
    }

    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>P1<span>C1</span></div>");

    parent.unmount();
    expect(fixture.innerHTML).toBe("");

    parent.state.val = "P2";
    child.state.val = "C2";

    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>P2<span>C2</span></div>");
  });

  test("unmount component during a re-rendering", async () => {
    const def = makeDeferred();
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
      willUpdateProps() {
        return def;
      }
    }
    Child.prototype.__render = jest.fn(Child.prototype.__render);

    class Parent extends Component<any, any> {
      static template = xml`<div><Child val="state.val"/></div>`;
      static components = { Child };
      state = useState({ val: 1 });
    }

    const parent = new Parent();
    await parent.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");
    expect(Child.prototype.__render).toBeCalledTimes(1);

    parent.state.val = 2;
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>1</span></div>");

    parent.unmount();
    expect(fixture.innerHTML).toBe("");

    def.resolve();
    await nextTick();
    expect(fixture.innerHTML).toBe("");
    expect(Child.prototype.__render).toBeCalledTimes(1);
  });
});

describe("dynamic root nodes", () => {
  test("template with t-if, part 1", async () => {
    class TestWidget extends Component<any, any> {
      static template = xml`
        <t>
          <t t-if="true"><span>hey</span></t>
          <t t-if="false"><div>abc</div></t>
        </t>
      `;
    }

    const widget = new TestWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<span>hey</span>");
  });

  test("template with t-if, part 2", async () => {
    class TestWidget extends Component<any, any> {
      static template = xml`
        <t>
          <t t-if="false"><span>hey</span></t>
          <t t-if="true"><div>abc</div></t>
        </t>
      `;
    }

    const widget = new TestWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div>abc</div>");
  });

  test("switching between sub branches dynamically", async () => {
    class TestWidget extends Component<any, any> {
      static template = xml`
        <t>
          <t t-if="state.flag"><span>hey</span></t>
          <t t-if="!state.flag"><div>abc</div></t>
        </t>
      `;
      state = useState({ flag: true });
    }

    const widget = new TestWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<span>hey</span>");
    widget.state.flag = false;
    await nextTick();

    expect(fixture.innerHTML).toBe("<div>abc</div>");
  });

  test("switching between sub components dynamically", async () => {
    class ChildA extends Component<any, any> {
      static template = xml`<span>hey</span>`;
    }
    class ChildB extends Component<any, any> {
      static template = xml`<div>abc</div>`;
    }
    class TestWidget extends Component<any, any> {
      static template = xml`
        <t>
            <t t-if="state.flag"><ChildA/></t>
            <t t-if="!state.flag"><ChildB/></t>
        </t>
      `;
      static components = { ChildA, ChildB };
      state = useState({ flag: true });
    }

    const widget = new TestWidget();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<span>hey</span>");
    widget.state.flag = false;
    await nextTick();

    expect(fixture.innerHTML).toBe("<div>abc</div>");
  });
});

describe("dynamic t-props", () => {
  test("basic use", async () => {
    expect.assertions(4);

    class Child extends Component<any, any> {
      static template = xml`
        <span>
            <t t-esc="props.a + props.b"/>
        </span>
      `;
      constructor(parent, props) {
        super(parent, props);
        expect(props).toEqual({ a: 1, b: 2 });
        expect(props).not.toBe(widget.some.obj);
      }
    }
    class Parent extends Component<any, any> {
      static template = xml`
        <div>
            <Child t-props="some.obj"/>
        </div>
      `;
      static components = { Child };

      some = { obj: { a: 1, b: 2 } };
    }

    const widget = new Parent();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>3</span></div>");
    expect(env.qweb.templates[Parent.template].fn.toString()).toMatchSnapshot();
  });
});

describe("support svg components", () => {
  test("add proper namespace to svg", async () => {
    class GComp extends Component<any, any> {
      static template = xml`
        <g>
            <circle cx="50" cy="50" r="4" stroke="green" stroke-width="1" fill="yellow"/>
        </g>`;
    }

    class Svg extends Component<any, any> {
      static template = xml`
        <svg>
            <GComp/>
        </svg>`;
      static components = { GComp };
    }
    const widget = new Svg();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe(
      '<svg><g><circle cx="50" cy="50" r="4" stroke="green" stroke-width="1" fill="yellow"></circle></g></svg>'
    );
  });
});

describe("t-raw in components", () => {
  test("update properly on state changes", async () => {
    class TestW extends Component<any, any> {
      static template = xml`<div><t t-raw="state.value"/></div>`;
      state = useState({ value: "<b>content</b>" });
    }
    const widget = new TestW();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><b>content</b></div>");

    widget.state.value = "<span>other content</span>";
    await nextTick();
    expect(fixture.innerHTML).toBe("<div><span>other content</span></div>");
  });

  test("can render list of t-raw ", async () => {
    class TestW extends Component<any, any> {
      static template = xml`
        <div>
            <t t-foreach="state.items" t-as="item">
            <t t-esc="item"/>
            <t t-raw="item"/>
            </t>
        </div>`;
      state = useState({ items: ["<b>one</b>", "<b>two</b>", "<b>tree</b>"] });
    }
    const widget = new TestW();
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe(
      "<div>&lt;b&gt;one&lt;/b&gt;<b>one</b>&lt;b&gt;two&lt;/b&gt;<b>two</b>&lt;b&gt;tree&lt;/b&gt;<b>tree</b></div>"
    );
  });
});

describe("t-call", () => {
  test("handlers are properly bound through a t-call", async () => {
    expect.assertions(3);
    env.qweb.addTemplate("sub", `<p t-on-click="update">lucas</p>`);
    class Parent extends Component<any, any> {
      static template = xml`<div><t t-call="sub"/></div>`;
      update() {
        expect(this).toBe(parent);
      }
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><p>lucas</p></div>");
    fixture.querySelector("p")!.click();
    expect(env.qweb.subTemplates["sub"].toString()).toMatchSnapshot();
  });

  test("parent is set within t-call", async () => {
    env.qweb.addTemplate("sub", `<Child/>`);
    let child;
    class Child extends Component<any, any> {
      static template = xml`<span>lucas</span>`;
      constructor() {
        super(...arguments);
        child = this;
      }
    }
    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<div><t t-call="sub"/></div>`;
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>lucas</span></div>");
    expect(child.__owl__.parent).toBe(parent);
    expect(env.qweb.subTemplates["sub"].toString()).toMatchSnapshot();
  });

  test("t-call in t-foreach and children component", async () => {
    env.qweb.addTemplate("sub", `<Child val="val"/>`);
    class Child extends Component<any, any> {
      static template = xml`<span><t t-esc="props.val"/></span>`;
    }
    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`
        <div>
          <t t-foreach="['a', 'b', 'c']" t-as="val" t-key="val">
            <t t-call="sub"/>
          </t>
        </div>`;
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>a</span><span>b</span><span>c</span></div>");
  });

  test("parent is set within t-call with no parentNode", async () => {
    env.qweb.addTemplate("sub", `<Child/>`);
    let child;
    class Child extends Component<any, any> {
      constructor() {
        super(...arguments);
        child = this;
      }
      static template = xml`<span>lucas</span>`;
    }
    class Parent extends Component<any, any> {
      static components = { Child };
      static template = xml`<t t-call="sub"/>`;
    }
    const parent = new Parent();
    await parent.mount(fixture);

    expect(fixture.innerHTML).toBe("<span>lucas</span>");
    expect(child.__owl__.parent).toBe(parent);
    expect(env.qweb.subTemplates["sub"].toString()).toMatchSnapshot();
  });

  test("handlers with arguments are properly bound through a t-call", async () => {
    expect.assertions(3);
    env.qweb.addTemplate("sub", `<p t-on-click="update(a)">lucas</p>`);
    class Parent extends Component<any, any> {
      static template = xml`<div><t t-call="sub"/></div>`;
      update(a) {
        expect(this).toBe(parent);
        expect(a).toBe(3);
      }
      a = 3;
    }
    const parent = new Parent();
    await parent.mount(fixture);
    expect(env.qweb.subTemplates["sub"].toString()).toMatchSnapshot();

    fixture.querySelector("p")!.click();
  });
});
