function eval_scoped(context, expr) {
	try {
		return (new Function( "with(this) { return " + expr + "}"))
			.call(context);
	} catch (e) {
		console.warn("eval_scoped", expr, e.message);
		return "";
	}
}

let m_directives = {
	"ng-if": {
		compile: (tElem, tAttrs) => {
			const parent = tElem.parent();
			return function(scope, iElem, iAttrs) {
				const value = tAttrs["ng-if"];
				const visible = eval_scoped(scope, value);
				if (visible)
					iElem[1].children.map(child => parent.append(scope, child));
			}
		},
	},
	"ng-disabled": {
		link: (scope, e, attrs) => {
			const ret = eval_scoped(scope, attrs["ng-disabled"]);
			attrs.$set("disabled", ret);
		}
	},
	"ng-submit": {
		link: (scope, e, attrs) => {
			const ret = scope[attrs["ng-submit"]];
			attrs.$set("onsubmit", ret)
		}
	},
	"ng-click": {
		link: (scope, e, attrs) => {
			attrs.$set("onclick", function (ev) {
				eval_scoped(scope, attrs["ng-click"]);
				ev.stopPropagation();
			});
		}
	},
	"ng-repeat": {
		transclude: "element",
		compile: (tElem, tAttrs, pscope) => {
			/* console.log("compile ng-repeat", tElem, tAttrs); */
			return function(scope, iElem, iAttrs) {
				const value = tAttrs["ng-repeat"];
				const parent = tElem.parent();
				const strs = value.split(" in ");
				let coll = eval_scoped(scope, strs[1]);

				if (!coll)
					coll = [];

				else if (!Array.isArray(coll))
					coll = Object.values(coll);

				coll.key = strs[0];
				scope.coll = coll;
				/* console.log("link ng-repeat", iElem, iAttrs, coll); */
				/* iElem[1].children.map(child => parent.append(scope, child)); */
				parent.append(scope, iElem[1]);
			};
		},
	},
};

function cc2dash(str) {
	return str.replace(/([a-z])([A-Z])/g, '$1-$2' ).toLowerCase();
}

function view_string_parse(html) {
	let tag = false;
	let string = false;
	let res = "";

	for (i = 0; i < html.length; i ++) {
		const c = html.charAt(i);
		switch (c) {
			case '<':
				if (string) {
					res += "&lt;";
					continue;
				}
				tag = true;
				break;
			case '>':
				if (string) {
					res += "&gt;";
					continue;
				}
				tag = false;
				break;
			case '&': res += "&amp;"; continue;
			case '"': string = !string; break;
		}
		res += c;
	}

	return res;
}

function view_parse(html) {
	const parser = new DOMParser();
	const str = view_string_parse(html);
	return parser.parseFromString(str, "text/xml");
}

function text_link(scope, val) {
	let ret = "";

	if (!val)
		return ret;

	if (typeof val !== "string")
		debugger;

	let estr = "";
	let mode = 0, i;
	for (i = 0; i < val.length; i++) {
		const c = val.charAt(i);

		switch (c) {
			case '{':
				if (mode == 0)
					mode ++;
				else if (mode == 1) {
					mode ++;
					continue;
				}
				break;
			case '}':
				if (mode == 2)
					mode ++;
				else if (mode == 3) {
					ret = ret.substr(0, ret.length - 2);
					ret += eval_scoped(scope, estr);
					estr = "";
					mode = 0;
					continue;
				}
				break;
			default:
				if (mode == 3)
					mode = 2;
				else if (mode == 1)
					mode = 0;
		}

		if (mode == 2)
			estr += c;
		else
			ret += c;
	}

	return ret;
}

function directive_compile(obj, attr) {
	const key = attr.nodeName;
	const directive = m_directives[key];

	if (!directive) {
		obj.iAttrs[key] = attr.nodeValue;
		return;
	}

	if (!directive.compile) {
		obj.directives[key] = directive.link;
		obj.iAttrs[key] = attr.nodeValue;
		return;
	}

	try {
		const cdirective = directive.compile({
			dom: obj.dom,
			parent: () => ({
				append: function (scope, child) {
					/* console.log("APPEND", scope, child); */
					scope.children.push(child);
				},
			}),
		}, obj.tAttrs, obj.dom)

		obj.tAttrs[key] = attr.nodeValue;
		obj.cdirective = (scope, child, iAttrs) => {
			return cdirective(scope, child, iAttrs);
		};
	} catch (e) {
		console.warn("directive_compile", e.message);
		return null;
	}
}

function mng_compile_r(tag = "view", dom) {
	/* console.log("mng_compile_r", tag, dom); */
	if (dom.nodeType == dom_t.COMMENT_NODE)
		return null;

	let ret = { tag, children: [], tAttrs: {}, iAttrs: {}, directives: {}, text: null };
	let i;

	if (dom.nodeType == dom_t.TEXT_NODE)
		return dom.textContent.trim();

	const attrs_a = dom.attributes || [];
	for (let i = 0; i < attrs_a.length; i++)
		directive_compile(ret, attrs_a[i]);

	const directive = m_directives[tag];
	if (directive) {
		const parsed = view_parse(directive.template);
		dom = parsed;
		/* ret.directive = directive; */
	}

	for (i = 0; i < dom.childNodes.length; i++) {
		const child = dom.childNodes[i];
		const cchild = mng_compile_r(child.nodeName, child);

		if (!cchild)
			continue;

		ret.children.push(cchild);
	}

	if (ret.cdirective) {
		ret.children = [{
			...ret,
			cdirective: false,
			children: ret.children,
			tAttrs: {},
		}];

		return { ...ret, iAttrs: {} };
	}

	return ret;
}

function eval_wrap(scope, value) {
	if (value)
		return eval_scoped(scope, "() => " + value);
	else
		return "";
}

function attr_parse(obj, attr, scope, dscope) {
	const key = attr.nodeName;
	let value = attr.nodeValue;

	if (typeof(value) !== "string") {
		console.warn("attr_parse", key, value);
		return -1;
	}

	const directive = obj.directives[key];
	if (directive) {
		if (!m_directives[key].compile)
			scope.directives[key] = directive;
		scope.iiAttrs[key] = value;
		return 1;
	}

	const ds_attr = dscope[key];

	switch (ds_attr) {
		case '&':
			value = eval_wrap(scope, value);
			break;
		case '@':
			value = text_link(scope, value);
			/* console.log("@", obj.tag, key, value, scope); */
			break;
		case '=':
			value = eval_scoped(scope, value);
			break;
		default: {
			value = text_link(scope, value);
			scope.attrs[key] = value;
			scope.iiAttrs[key] = value;
			return 0;
		 }
	}

	scope[key] = value;
	return 1;
}

function attrs_parse(obj, scope, dscope) {
	let attrs_a = Object.keys(obj.iAttrs).map(k => ({ nodeName: k, nodeValue: obj.iAttrs[k] }));

	for (let j = 0; j < attrs_a.length; j++) {
		const attr = attrs_a[j];
		attr_parse(obj, attr, scope, dscope);
	}

	/* if (attrs_a.length) */
	/* 	console.log("attrs_parse", obj.dom.nodeName, obj.attrs, obj.directives, "\n", attrs_a, "\n", scope.iiAttrs, "\n", scope.attrs, scope.directives); */
}

function directives_link(obj, scope, vnode) {
	const dkeys = Object.keys(obj.directives);

	if (!dkeys.length)
		return;

	/* console.log("directives_link", obj.directives); */

	for (let j = 0; j < dkeys.length; j++) {
		const key = dkeys[j];
		const link = obj.directives[key];
		try {
			link(scope, [vnode.dom, obj], scope.iiAttrs);
		} catch (e) {
			console.warn("directives_link", obj.tag, key, e.message);
		}
	}
}

function mng_view_r_child(cscope, child) {
	return typeof child == "string"
		? text_link(cscope, child)
		: mng_view_r(cscope, child)
}

function mng_view_r(pscope, obj) {
	if (!obj)
		return null;

	let scope = {
		...pscope,
		children: [],
		attrs: {},
		directives: {},
		iiAttrs: {
			$set: function (name, value) {
				scope.attrs[name] = value;
			},
		}
	};

	let Res = {};
	Res.oninit = Res.oncreate = function (vnode) {
		const directive = m_directives[obj.tag];
		const dscope = directive && directive.scope || {};
		attrs_parse(obj, scope, dscope);

		if (obj.cdirective) {
			try {
				obj.cdirective(scope, [vnode.dom, obj], scope.iiAttrs);
			} catch (e) {
				console.warn("cdirective_link", e.message);
			}
			return;
		}

		directives_link(obj, scope, vnode);
		scope.children = Array.from(obj.children);
	};

	Res.view = function (vnode) {
		/* console.log("VIEW", obj.tag, vnode); */
		if (obj.cdirective && !scope.children.length)
			return null;

		if (!obj.cdirective)
			return m(obj.tag, vnode.attrs, scope.children
				.map(mng_view_r_child.bind(null, scope)));

		let children = [];

		if (scope.coll)
			return scope.coll.map(item => {
				let cscope = { ...scope };
				cscope[scope.coll.key] = item;
				return mng_view_r_child(cscope, obj.children[0]);
			});
		else
			return scope.children.map(mng_view_r_child.bind(null, scope));
	};

	/* console.log("mng_view", obj.tag, scope.children); */
	return m(Res, scope.attrs, []);
}

function view_compile(name, html, controller, state) {
	const str = "<" + name + ">" + html + "</" + name + ">";
	const dom = view_parse(str);
	console.log("view parsed", name, dom);
	const compiled = mng_compile_r("view", dom, {}).children[0];
	console.log("COMPILED!", name, compiled);

	return function (initialVnode) {
		const scope = {
			$apply: () => m.redraw(),
		};

		controller(scope, state);

		return { view: mng_view_r.bind(null, scope, compiled) };
	}
}

function mng_mount(element, defaultRoute, views) {
	let routes = {};
	const views_a = Object.keys(views);

	for (let i = 0; i < views_a.length; i ++) {
		const key = views_a[i];
		const value = views[key];

		let state = {
			params: {
				...value.params,
				tits: true,
			},

			go: function (to, params = {}) {
				let rparams = {};
				let fparams = {};
				const keys = Object.keys(params);

				for (let j = 0; j < keys.length; j++) {
					const key = keys[j];
					const value = params[key];
					(typeof value === "object" ? fparams : rparams)[key] = value;
				}

				state.params = {
					...rparams,
					...fparams,
				};

				m.route.set(to, rparams);
			},
		};

		routes[key] = {
			onmatch: function (args, requestedPath, route) {
				state.params = {
					...state.params,
					...args,
				};
				console.log("onmatch", key, value, state.params);
				return fetch(value.templateUrl)
					.then(res => res.text())
					.then(html => {
						return view_compile("view", html, value.controller, state);
					});
			},
		};
	}

	let droute = defaultRoute;
	let idx = location.href.indexOf("#!");
	let loc = location.href.substr(idx + 2);
	idx = loc.indexOf("?");
	droute = idx >= 0 ? loc.substr(0, idx) : loc;
	console.log("mng_mount", views, routes, droute, loc);
	m.route(element, droute, routes);
}
