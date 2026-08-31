import NodeKind, { nodeKindName } from '../syntax/nodeKind';
import * as Keywords from '../syntax/keywords';
import Node, { createNode } from '../syntax/node';
import assign = require('object-assign')
import { CustomVisitor } from '../custom-visitors';
import { VERBOSE_MASK, AS3_UTIL, INTERFACE_METHOD, INTERFACE_INF, WARNINGS, FOR_IN_KEY, FOR_IN_OBJ, INDENT } from '../config';
import * as Operators from '../syntax/operators';
import * as assert from 'assert';
import ClassList, { ClassKind, ClassMember, ClassMemberKind, ClassRecord, ModifierKind, MODIFIERS } from "./classlist";
import { ReportFlags } from '../reports/report-flags';

const util = require('util');

export const GLOBAL_NAMES = [
	'undefined',
	'NaN',
	'Infinity',
	'Array',
	'Boolean',
	'decodeURI',
	'decodeURIComponent',
	'encodeURI',
	'encodeURIComponent',
	'escape',
	'int',
	'isFinite',
	'isNaN',
	'isXMLName',
	'Number',
	'Object',
	'parseFloat',
	'parseInt',
	'String',
	'trace',
	'uint',
	'unescape',
	'Vector',
	'XML',
	'XMLList',
	'Namespace',
	'QName',
	'getDefinitionByName',
	'arguments',
	'Class',
	'Date',
	'Function',
	'Math',
	'RegExp',
	'JSON',
	'Error',
	'EvalError',
	'RangeError',
	'ReferenceError',
	'SyntaxError',
	'TypeError',
	'URIError',
	'Element',
	'DOMParser',
	'Document',
	'Node',
	'Attr'
];

export const TYPE_REMAP: { [id: string]: string } = {
	Class: 'any', // 80pro: was mapped to 'Object' before
	Object: 'any',
	String: 'string',
	Boolean: 'boolean',
	Number: 'number',
	int: 'number',
	uint: 'number',
	'*': 'any',
	Array: 'any[]',
	Vector: 'Array',    // if the unparameterized type 'Vector' ever appears, replace it with 'Array'
	Dictionary: 'Object', // 80pro: was mapped to 'Map<any, any>' before

	// Inexistent errors
	ArgumentError: 'Error',
	DefinitionError: 'Error',
	SecurityError: 'Error',
	VerifyError: 'Error'
};

// TODO: improve me (used only on emitType())
export const TYPE_REMAP_VALUES = ['void'];
for (var k in TYPE_REMAP) {
	TYPE_REMAP_VALUES.push(TYPE_REMAP[k]);
}

const IDENTIFIER_REMAP: { [id: string]: string } = {
	'Dictionary': 'Map<any, any>',

	// Inexistent errors
	'ArgumentError': 'Error',
	'DefinitionError': 'Error',
	'SecurityError': 'Error',
	'VerifyError': 'Error',
	'getDefinitionByName': 'AS3Utils.getDefinitionByName'
}

interface Scope {
	parent: Scope;
	declarations: Declaration[];
	className?: string;
}

/*class Scope {
	public parent:Scope;
	public declarations:Declaration[];
	public className:string;
}

class Declaration {
	public name:string;
	public type:string;
	public bound:string;
}*/


interface Declaration {
	name: string;
	type?: string;
	bound?: string;
}

export interface EmitterOptions {
	lineSeparator: string;
	useNamespaces: boolean;
	customVisitors: CustomVisitor[];
	definitionsByNamespace?: { [ns: string]: string[] };
}

interface NodeVisitor {
	(emitter: Emitter, node: Node): void;
}


const VISITORS: { [kind: number]: NodeVisitor } = {
	[NodeKind.PACKAGE]: emitPackage,
	[NodeKind.META]: emitMeta,
	[NodeKind.IMPORT]: emitImport,
	[NodeKind.EMBED]: emitEmbed,
	[NodeKind.USE]: emitUse,
	[NodeKind.FUNCTION]: emitFunction,
	[NodeKind.LAMBDA]: emitFunction,
	[NodeKind.FOREACH]: emitForEach,
	[NodeKind.FORIN]: emitForIn,
	[NodeKind.INTERFACE]: emitInterface,
	[NodeKind.CLASS]: emitClass,
	[NodeKind.VECTOR]: emitVector,
	[NodeKind.SHORT_VECTOR]: emitShortVector,
	[NodeKind.TYPE]: emitType,
	[NodeKind.CALL]: emitCall,
	[NodeKind.CATCH]: emitCatch,
	[NodeKind.NEW]: emitNew,
	[NodeKind.RELATION]: emitRelation,
	[NodeKind.OP]: emitOp,
	[NodeKind.OR]: emitOr,
	[NodeKind.IDENTIFIER]: emitIdent,
	[NodeKind.XML_LITERAL]: emitXMLLiteral,
	[NodeKind.CONST_LIST]: emitConstList,
	[NodeKind.NAME_TYPE_INIT]: emitNameTypeInit,
	[NodeKind.VALUE]: emitObjectValue,
	[NodeKind.DOT]: emitDot,
	[NodeKind.LITERAL]: emitLiteral,
	[NodeKind.ARRAY]: emitArray,
	[NodeKind.BREAK]: emitLoopBranch,
	[NodeKind.CONTINUE]: emitLoopBranch,
	[NodeKind.ASSIGN]: emitAssignment,
	[NodeKind.BLOCK]: emitBlock,
	[NodeKind.MINUS]: emitMinus,
	//[NodeKind.PARAMETER_LIST]: emitParametersList
};


export function visitNodes(emitter: Emitter, nodes: Node[]): void {
	if (nodes) {
		nodes.forEach(node => visitNode(emitter, node));
	}
}

export function visitNode(emitter: Emitter, node: Node): void {
	if (!node) {
		return;
	}

	// use custom visitor. allow custom node manipulation
	for (let i = 0, l = emitter.options.customVisitors.length; i < l; i++) {
		let customVisitor = emitter.options.customVisitors[i];
		if (customVisitor.visit(emitter, node) === true) {
			return;
		}
	}

	let visitor = VISITORS[node.kind] || function (emitter: Emitter, node: Node): void {
		emitter.catchup(node.start);
		visitNodes(emitter, node.children);
	};

	//if (VERBOSE >= 2 && VISITORS[node.kind]) {
	if ((VERBOSE_MASK & ReportFlags.NODES_TREE) == ReportFlags.NODES_TREE && VISITORS[node.kind]) {
		console.log(
			'visit:' +
			VISITORS[node.kind].name +
			'() <====================================='
		);
		console.log('node: ' + node.toString());
	}

	visitor(emitter, node);

}

function filterAST(node: Node): Node {
	function isInteresting(child: Node): boolean {
		// we don't care about comment
		return (
			!!child &&
			child.kind !== NodeKind.AS_DOC &&
			child.kind !== NodeKind.MULTI_LINE_COMMENT
		);
	}

	let newNode = createNode(
		node.kind,
		node,
		...node.children.filter(isInteresting).map(filterAST));

	newNode.children.forEach(child => child.parent = newNode);

	return newNode;
}

export class ImportStatement {
	public constructor(public identifier: string, public source: string) { }
}

export default class Emitter {
	public isNew: boolean = false;
	public isExtended: boolean = false;
	public skipNewLines: boolean = false;
	public loopObjectCounter: number = 0;

	public extraImportsNeeded: ImportStatement[] = [];

	private _emitThisForNextIdent: boolean = true;
	get emitThisForNextIdent(): boolean {
		return this._emitThisForNextIdent;
	}
	set emitThisForNextIdent(val: boolean) {
		this._emitThisForNextIdent = val;
	}

	public source: string;
	public options: EmitterOptions;

	public headOutput: string = "";

	public output: string = '';
	public index: number = 0;

	/*	public rootScope:Scope = null;
		public scope:Scope = null;*/

	get scope(): Scope {
		return this._scope;
	}

	set scope(value: Scope) {
		this._scope = value;
	}
	private _scope: Scope;

	get rootScope(): Scope {
		return this._rootScope;
	}

	set rootScope(value: Scope) {
		this._rootScope = value;
	}

	private _rootScope: Scope;


	constructor(source: string, options?: EmitterOptions) {
		this.source = source;
		this.options = assign({
			includePath: "",
			lineSeparator: '\n',
			useNamespaces: false,
			customVisitors: []
		}, options || {});
	}

	emit(ast: Node): string {

		//if(VERBOSE >= 1) {
		if ((VERBOSE_MASK & ReportFlags.KEY_POINTS) == ReportFlags.KEY_POINTS) {
			console.log("emit() ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑");
		}

		this.withScope([], rootScope => {
			this.rootScope = rootScope;
			visitNode(this, filterAST(ast));
			this.catchup(this.source.length - 1);
		});

		// notify all customVisitors about the extra imports that were needed,
		// if the CustomVisitor wishes to hear about this information
		this.options.customVisitors.forEach((visitor: CustomVisitor) => {
			if (visitor.respondToExtraImportsNeeded) {
				visitor.respondToExtraImportsNeeded(this.extraImportsNeeded);
			}
		});

		let headOutput = this.extraImportsNeeded
			.map(extraImportsNeeded => {
				return `import { ${extraImportsNeeded.identifier} } from "${extraImportsNeeded.source}";`;
			})
			.join('\n');

		if (headOutput.length > 0) {
			headOutput += '\n';
		}

		return headOutput + this.output;
	}

	enterScope(declarations: Declaration[]): Scope {
		return (this.scope = { parent: this.scope, declarations });
	}

	exitScope(checkScope: Scope = null): void {
		if (checkScope && this.scope !== checkScope) {
			throw new Error('Mismatched enterScope() / exitScope().');
		}
		if (!this.scope) {
			throw new Error('Unmatched exitScope().');
		}
		this.scope = this.scope.parent;
	}

	withScope(declarations: Declaration[], body: (scope: Scope) => void): void {
		let scope = this.enterScope(declarations);
		try {
			body(scope);
		} finally {
			this.exitScope(scope);
		}
	}

	get currentClassName(): string {
		for (var scope = this.scope; scope; scope = scope.parent) {
			if (scope.className) {
				return scope.className;
			}
		}
		return '';
	}

	declareInScope(declaration: Declaration): void {
		let previousDeclaration: Declaration = null;
		for (var i = 0, len = this.scope.declarations.length; i < len; i++) {
			if (this.scope.declarations[i].name === declaration.name) {
				previousDeclaration = this.scope.declarations[i];
			}
		}

		if (previousDeclaration) {
			if (declaration.type !== undefined)
				previousDeclaration.type = declaration.type;
			if (declaration.bound !== undefined)
				previousDeclaration.bound = declaration.bound;
		} else {
			this.scope.declarations.push(declaration);
		}
	}


	findDefInScope(text: string): Declaration {
		let scope = this.scope;
		while (scope) {
			for (let i = 0; i < scope.declarations.length; i++) {
				if (scope.declarations[i].name === text) {
					return scope.declarations[i];
				}
			}
			scope = scope.parent;
		}
		return null;
	}

	commentNode(node: Node, catchSemi: boolean): void {
		this.catchup(node.start);
		this.insert('/*');
		const source = this.sourceBetween(this.index, node.end).replace(
			/\*\//g,
			''
		);
		this.insert(source);
		this.skipTo(node.end);

		let index = this.index;
		if (catchSemi) {
			while (true) {
				if (index >= this.source.length) {
					break;
				}
				if (this.source[index] === '\n') {
					this.catchup(index);
					break;
				}
				if (this.source[index] === ';') {
					this.catchup(index + 1);
					break;
				}
				index++;
			}
		}
		this.insert('*/');
	}

	catchup(index: number): void {
		if (this.index >= index) {
			return;
		}
		let text = this.sourceBetween(this.index, index);
		this.index = index;
		this.insert(text);
	}
	setIndexPos(index: number): void {
		this.index = index;

	}

	sourceBetween(start: number, end: number) {
		return this.source.substring(start, end);
	}

	skipTo(index: number): void {
		this.index = index;
	}

	getIndex(): number {
		return this.index;
	}

	skip(number: number): void {
		this.index += number;
	}

	insert(str: string): void {
		this.output += str;
		this.output = this.output.replace(/\s([^\n])\s*?=>/gm, " =>");//TODO hotfix. To remove new lines between arrow operator and {

		// Debug util (comment out on production).
		// let split = this.output.split(" ");
		// let lastWord = split[split.length - 1];
		// console.log("    emitter.ts - output += " + lastWord);
		// process.stdout.write(" " + lastWord);
		// console.log("+++++++++ " + (string.indexOf("for(") !== -1));
		//if(VERBOSE >= 2 ) {
		if ((VERBOSE_MASK & ReportFlags.TRANSPILED_CODE) == ReportFlags.TRANSPILED_CODE) {
			console.log("output (all): " + this.output);
			// let a = 1; // insert breakpoint here
		}
	}

	consume(string: string, limit: number): void {
		let index = this.source.indexOf(string, this.index) + string.length;
		if (index > limit || index < this.index) {
			throw new Error('invalid consume');
		}
		this.index = index;
	}
	consumeRegExp(reg: RegExp, limit: number): void {
		let matches = this.source.slice(this.index).match(reg) || [];
		if (matches.length < 1) return
		let matchStr = matches[0];
		let index = this.source.indexOf(matchStr, this.index) + matchStr.length;
		if (index > limit || index < this.index) return
		this.index = index;
	}

	/**
	 * Utilities
	 */
	ensureImportIdentifier(identifier: string, from = `./${identifier}`, checkGlobals: boolean = true): void {
		if (identifier == "number" || identifier == "number[]"
			|| identifier == "any" || identifier == "any[]"
			|| identifier == "boolean" || identifier == "boolean[]"
			|| identifier == "string" || identifier == "string[]"
			|| identifier == "Array")
			return;

		// warning if this is a as3-path, not a plain name (like shared.Node should error)
		if (WARNINGS >= 1 && identifier.split(".").length > 1) {
			console.log(`emitter.ts: *** MAJOR WARNING *** ensureImportIdentifier() => : invalid object name identifier: ${identifier})`)
		}

		let isGloballyAvailable = checkGlobals
			? GLOBAL_NAMES.indexOf(identifier) >= 0
			: false;

		// change to root scope temporarily
		let previousScope = this.scope;
		this.scope = this.rootScope;

		// Ensure this file is not declaring this class
		if (
			new RegExp(`class\\s+${identifier}\\s`).test(this.source) ===
			false && !isGloballyAvailable && !this.findDefInScope(identifier)
		) {
			this.extraImportsNeeded.push(new ImportStatement(identifier, from));
			this.declareInScope({ name: identifier });
		}

		// change back to previous scope
		this.scope = previousScope;
	}

	getTypeRemap(text: string): string {
		for (let i = 0, l = this.options.customVisitors.length; i < l; i++) {
			let customVisitor = this.options.customVisitors[i];
			if (customVisitor.typeMap && customVisitor.typeMap[text]) {
				return customVisitor.typeMap[text];
			}
		}
		return TYPE_REMAP[text];
	}

	getIdentifierRemap(text: string): string {
		for (let i = 0, l = this.options.customVisitors.length; i < l; i++) {
			let customVisitor = this.options.customVisitors[i];
			if (
				customVisitor.identifierMap &&
				customVisitor.identifierMap[text]
			) {
				return customVisitor.identifierMap[text];
			}
		}
		return IDENTIFIER_REMAP[text];
	}
}

function emitPackage(emitter: Emitter, node: Node): void {
	let packageName = node.findChild(NodeKind.NAME);
	let content = node.findChild(NodeKind.CONTENT);

	if (content) {
		let classNode = content.findChild(NodeKind.CLASS);
		let classRecord: ClassRecord;
		if (classNode) {
			let className = classNode.findChild(NodeKind.NAME);
			let classList = ClassList.classList;
			classRecord = new ClassRecord(packageName.text, className.text);
			classRecord.classKind = ClassKind.CLASS;
		}
		let interfaceNode = content.findChild(NodeKind.INTERFACE);
		if (interfaceNode) {
			let interfaceName = interfaceNode.findChild(NodeKind.NAME);
			let interfaceList = ClassList.classList;
			classRecord = new ClassRecord(packageName.text, interfaceName.text);
			classRecord.classKind = ClassKind.INTERFACE;

		}
		if (classRecord) {
			if (ClassList.isScanning) {
				ClassList.addClass(classRecord);
			}
			else {
				ClassList.setCurrentClassRecord(classRecord);
			}

		}
	}

	if (emitter.options.useNamespaces) {
		emitter.catchup(node.start);
		emitter.skip(Keywords.PACKAGE.length);
		emitter.insert('namespace');
		visitNodes(emitter, node.children);

	} else {
		emitter.catchup(node.start);
		emitter.skip(Keywords.PACKAGE.length + node.children[0].text.length + 4);

		visitNodes(emitter, node.children);

		let indexAfterPackageContents = emitter.output.length;

		// because we're removing the 'package' declaration and, therefore, a logical scoping/indentation level,
		// physically remove any addition indentation this package scope introduced

		// pull out all lines added by visiting the package contents
		let linesInPackageContents = emitter.output
			.substring(indexBeforePackageContents)
			.split('\n');

		// ignore the first line, which is the line that contains the package's left curly bracket, and should just contain whitespace
		let lineContainingLeftCurlyBracket = linesInPackageContents[0];
		linesInPackageContents.shift();

		let linesBeginningWithExportModifer = linesInPackageContents.filter(
			line => /^\s*export/.test(line)
		);

		if (!/^\s*$/.test(lineContainingLeftCurlyBracket)) {
			if (WARNINGS >= 1) {
				console.log(
					`emitter.ts: *** MINOR WARNING *** emitPackage() => : package open curly bracket isn't only followed by whitespace, which is unexpected. Result: package indentation not corrected`
				);
			}
		} else if (linesBeginningWithExportModifer.length == 0) {
			if (WARNINGS >= 1) {
				console.log(
					`emitter.ts: *** MINOR WARNING *** emitPackage() => : no lines in the package definition begin with 'export', which is unexpected. Result: package indentation not corrected`
				);
			}
		} else {
			// and remove the leading whitespace from all lines
			let leftPaddingToRemove = linesBeginningWithExportModifer[0].match(
				/^(\s*)export/
			)[1];
			let regexMatchingLeftPadding = RegExp('^' + leftPaddingToRemove);
			let linesWithLeftPaddingRemoved = linesInPackageContents.map(line =>
				line.replace(regexMatchingLeftPadding, '')
			);
			let adjustedLinesInPackageContents = linesWithLeftPaddingRemoved.join(
				'\n'
			);
			emitter.output =
				emitter.output.substring(0, indexBeforePackageContents) +
				adjustedLinesInPackageContents;
		}

		emitter.catchup(node.end - 1); // catchup to *just* before the closing bracket of the package declaration
		emitter.skip(1); // skip the closing bracket
	}
}

function emitMeta(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);

	if (emitter.index === node.start) {
		emitter.commentNode(node, false);
	} else {
		// emitter is already past this node's starting point,
		// which can happen because some statements (e.g. imports) can appear between metadata and the thing the metadata decorates,
		// which means the other statement (e.g. the import) has been emitted, moving the emitter well past the point where this metadata appears in the source (e.g. it appears before the 'import'),
		// likely meaning that the text in the source for this metadata was just skipped and faithfully copied to the output,
		// meaning that we just have to find this text as it already exists in the output and 'comment' it there
		let metaToComment = emitter.sourceBetween(node.start, node.end);
		let startInOutput = emitter.output.lastIndexOf(metaToComment);
		if (startInOutput === -1) {
			if (WARNINGS >= 1) {
				console.log(
					`emitter.ts: *** MAJOR WARNING *** emitMeta() => : attempted to comment metadata '${metaToComment}' but emitter has already emitted output past this point, and this text in metadata in question doesn't already appear in the output.  No idea what could cause this`
				);
			}
		} else {
			emitter.output =
				emitter.output.slice(0, startInOutput) +
				'/*' +
				metaToComment +
				'*/' +
				emitter.output.slice(startInOutput + metaToComment.length);
		}
	}
}

function emitUse(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.commentNode(node, false);
}

function emitEmbed(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.commentNode(node, false);
}

function emitImport(emitter: Emitter, node: Node): void {
	let statement = Keywords.IMPORT + " ";
	/*	let split = node.text.split('.');
		let name = split[split.length - 1];
		split.pop();
		let ns = split.join(".");*/
	ClassList.addImportToLast(node.text.concat());

	// emit one import statement for each definition found in that namespace
	if (node.text.indexOf('*') !== -1) {
		let ns = node.text.substring(0, node.text.length - 2);
		let definitions = emitter.options.definitionsByNamespace[ns];

		let skipTo = node.end;

		if (definitions && definitions.length > 0) {
			emitter.catchup(node.start); // to ensure that left padding on the '*' import is correctly recognized and duplicated across all generated imports below
			let leftPadding = /[ \t]*$/.exec(emitter.output)[0]; // all trailing whitespace

			definitions.forEach(definition => {
				let importNode = createNode(node.kind, node);
				importNode.text = `${ns}.${definition}`;
				importNode.parent = node.parent;
				emitImport(emitter, importNode);
				emitter.insert(';\n' + leftPadding);
			});

			skipTo = node.end + Keywords.IMPORT.length + 2;
		} else {
			emitter.catchup(node.start);
			node.end += node.text.length - ns.length + 6;
			emitter.commentNode(node, true);
			skipTo = node.end;
			if (WARNINGS >= 1) {
				console.log(
					`emitter.ts: *** MINOR WARNING *** emitImport() => : nothing found to import on namespace ${ns}. (import ${node.text})`
				);
			}
		}

		emitter.skipTo(skipTo);
		return;
	}

	let text = node.text.concat();
	let hasCustomVisitor = false;

	// apply custom visitor import maps
	for (let i = 0, l = emitter.options.customVisitors.length; i < l; i++) {
		let customVisitor = emitter.options.customVisitors[i];
		if (customVisitor.imports) {
			hasCustomVisitor = true;
			customVisitor.imports.forEach((replacement, regexp) => {
				text = text.replace(regexp, replacement);
			});
		}
	}

	// // apply "bridge" translation
	// if (emitter.hasBridge && emitter.options.bridge.imports) {
	//     text = node.text.concat();
	//     emitter.options.bridge.imports.forEach((replacement, regexp) => {
	//         text = text.replace(regexp, replacement);
	//     });
	// }

	if (emitter.options.useNamespaces) {
		emitter.catchup(node.start);
		emitter.insert(statement);

		let split = node.text.split('.');
		let name = split[split.length - 1];
		emitter.insert(name + ' = ');

		// apply custom visitor translation
		if (hasCustomVisitor) {
			let diff = node.text.length - text.length;

			emitter.insert(text);
			emitter.skip(text.length + diff + statement.length);

		} else {
			emitter.catchup(node.end + statement.length);
		}

		emitter.declareInScope({ name });
	} else {
		emitter.catchup(node.start);
		emitter.insert(Keywords.IMPORT + ' ');

		let split = text.split('.');
		let name = split.pop();

		// Find current module name to output relative import
		let currentModule = "";
		let parentNode = node.parent;
		while (parentNode) {
			if (parentNode.kind === NodeKind.PACKAGE) {
				currentModule = parentNode.children[0].text;
				break;
			}
			parentNode = parentNode.parent;
		}

		// const importPath = getRelativePath(currentModule.split("."), text.split("."));
		const importPath = text.replace(/\./g, '/');

		text = `{ ${name} } from "${importPath}"`;
		emitter.insert(text);
		emitter.skipTo(node.end);
		emitter.declareInScope({ name });
	}
}

function getRelativePath(currentPath: string[], targetPath: string[]) {
	while (currentPath.length > 0 && targetPath[0] === currentPath[0]) {
		currentPath.shift();
		targetPath.shift();
	}

	let relative = (currentPath.length === 0)
		? "."
		: currentPath.map(() => "..").join("/")

	return `${relative}/${targetPath.join("/")}`;
}

function getDeclarationType(emitter: Emitter, node: Node): string {
	let declarationType: string = null;
	let typeNode = node && node.findChild(NodeKind.TYPE);

	if (typeNode) {
		declarationType = emitter.getTypeRemap(typeNode.text) || typeNode.text;
	}

	return declarationType;
}

function emitInterface(emitter: Emitter, node: Node): void {
	emitDeclaration(emitter, node);

	//we'll catchup the other part
	emitter.declareInScope({
		name: node.findChild(NodeKind.NAME).text
	});

	// ensure extends identifiers are being imported
	let extendsNodes = node.findChildren(NodeKind.EXTENDS);
	extendsNodes.forEach(extendsNode => {
		emitter.ensureImportIdentifier(extendsNode.text);
	});

	let content = node.findChild(NodeKind.CONTENT);
	let contentsNode = content && content.children;
	let foundVariables: { [name: string]: boolean } = {};
	if (contentsNode) {
		contentsNode.forEach(node => {
			visitNode(emitter, node.findChild(NodeKind.META_LIST));
			emitter.catchup(node.start);
			let type = node.findChild(NodeKind.TYPE) || node.children[2];
			if (node.kind === NodeKind.TYPE && node.text === "function") {
				emitter.skip(Keywords.FUNCTION.length + 1);
				//visitNode(emitter, node.findChild(NodeKind.PARAMETER_LIST));
				let parametersListNode = node.findChild(NodeKind.PARAMETER_LIST);
				if (parametersListNode) {
					let params = parametersListNode.children;
					for (var i = 0; i < params.length; i++) {
						let parameterNode = params[i];
						if (parameterNode.kind == NodeKind.PARAMETER) {
							let nameTypeInitNode = parameterNode.findChild(NodeKind.NAME_TYPE_INIT);
							if (nameTypeInitNode) {
								let nameNode = nameTypeInitNode.findChild(NodeKind.NAME);
								let typeParamNode = nameTypeInitNode.findChild(NodeKind.TYPE);
								let initNode = nameTypeInitNode.findChild(NodeKind.INIT);
								if (initNode) {
									//visitNode(emitter, nameNode);
									//emitter.skipTo(nameNode.start);
									//emitter.insert(nameNode.text);
									if (typeParamNode) {
										emitter.catchup(nameNode.start);
										//visitNode(emitter, nameNode);
										//emitter.skipTo(nameNode.end);
										//emitter.skipTo(typeParamNode.start);
										emitter.insert(nameNode.text);
										emitter.skipTo(typeParamNode.end);
										emitter.insert("?:");

										visitNode(emitter, typeParamNode);
										emitter.skipTo(nameTypeInitNode.end);
										//isitNode(emitter, initNode);
									}
									else {
										emitter.insert("?");
									}


									//emitter.skipTo(nameTypeInitNode.end);
								}
								else {
									visitNode(emitter, nameNode);
									//emitter.catchup(nameTypeInitNode.end);
								}

							}
						}
						else {
							console.log(`emitter.ts: *** WARNING *** there is unexpected node "${parameterNode}" in PARAMETER_LIST`);
						}
					}

				}


				visitNode(emitter, type);

			} else if (node.kind === NodeKind.GET || node.kind === NodeKind.SET) {
				let name = node.findChild(NodeKind.NAME);
				let parameterList = node.findChild(NodeKind.PARAMETER_LIST);
				if (!foundVariables[name.text]) {
					emitter.skipTo(name.start);
					emitter.catchup(name.end);
					foundVariables[name.text] = true;

					if (node.kind === NodeKind.GET) {
						emitter.skipTo(parameterList.end);
						if (type) {
							emitType(emitter, type);
						}

					} else if (node.kind === NodeKind.SET) {
						let parameterNode = parameterList.findChild(NodeKind.PARAMETER);
						let nameTypeInit = parameterNode.findChild(NodeKind.NAME_TYPE_INIT);
						emitter.skipTo(nameTypeInit.findChild(NodeKind.NAME).end);
						type = nameTypeInit.findChild(NodeKind.TYPE);
						if (type) {
							emitType(emitter, type);
						}
						emitter.skipTo(node.end);
					}

				} else {
					emitter.commentNode(node, true);
				}

			} else {
				//include or import in interface content not supported
				emitter.commentNode(node, true);
			}
		});
	}
}

function getFunctionDeclarations(emitter: Emitter, node: Node): Declaration[] {
	let decls: Declaration[] = [];
	let params = node.findChild(NodeKind.PARAMETER_LIST);
	if (params && params.children.length) {
		decls = params.children.map(param => {
			let nameTypeInit = param.findChild(NodeKind.NAME_TYPE_INIT);
			if (nameTypeInit) {
				return {
					name: nameTypeInit.findChild(NodeKind.NAME).text,
					type: getDeclarationType(emitter, nameTypeInit)
				};
			}
			let rest = param.findChild(NodeKind.REST);
			return { name: rest.text };
		});
	}
	let block = node.findChild(NodeKind.BLOCK);
	if (block) {
		function traverse(node: Node): Declaration[] {
			let result: Declaration[] = [];
			if (
				node.kind === NodeKind.VAR_LIST ||
				node.kind === NodeKind.CONST_LIST ||
				node.kind === NodeKind.VAR ||
				node.kind === NodeKind.CONST
			) {
				result = result.concat(
					node.findChildren(NodeKind.NAME_TYPE_INIT).map(node => ({
						name: node.findChild(NodeKind.NAME).text
					}))
				);
			}
			if (
				node.kind !== NodeKind.FUNCTION &&
				node.kind !== NodeKind.LAMBDA &&
				node.children &&
				node.children.length
			) {
				result = Array.prototype.concat.apply(
					result,
					node.children.map(traverse)
				);
			}
			return result.filter(decl => !!decl);
		}

		decls = decls.concat(traverse(block));
	}
	return decls;
}

export function hasStaticModifer(setOrGetNode: Node): boolean {
	return (
		setOrGetNode
			.findChild(NodeKind.MOD_LIST)
			.findChildren(NodeKind.MODIFIER)
			.filter(modifier => modifier.text === Keywords.STATIC).length > 0
	);
}

function emitFunction(emitter: Emitter, node: Node): void {
	assert(node.kind === NodeKind.FUNCTION || node.kind === NodeKind.LAMBDA);

	// figure out if we are we inside a class function definition
	// Note: "ActionScript 3.0 supports neither nested nor private classes" (http://help.adobe.com/en_US/ActionScript/3.0_ProgrammingAS3/WS5b3ccc516d4fbf351e63e3d118a9b90204-7f9e.html)
	// so if we're inside a class function definition we must be inside only ONE class function definition, and we can just find the first one
	let classFunctionContainingThisFunction = node
		.getParentChain()
		.find(ancestor => {
			if (ancestor.kind === NodeKind.FUNCTION) {
				return (
					// Note: Nodes with kind NodeKind.FUNCTION always have two generations of parents, so checking for null/undefined in the accessors below is unnecessary
					ancestor.parent.kind === NodeKind.CONTENT &&
					ancestor.parent.parent.kind == NodeKind.CLASS
				);
			}
			return false;
		});

	if (node.text != null) {
		emitter.declareInScope({ name: node.text });
	}

	if (
		!(
			typeof classFunctionContainingThisFunction === 'undefined' ||
			hasStaticModifer(classFunctionContainingThisFunction)
		)
	) {
		// we're emitting a function that's defined inside a member function,
		// meaning that the object that this member function is being called upon has its member variables in scope,
		// so we should transform this function declaration into a fat arrow function to capture the value of 'this'
		// (elsewhere, the emitter will be prepending 'this' to references to variables that weren't defined locally)
		// NOTE: this choice to transform the lambda expression into a fat arrow function is likely wrong if the lambda body already references 'this',
		// TODO: detect this usage of 'this' inside the body and avoid such a transformation to a fat arrow function,
		// such functions in ActionScript will only become correct TypeScript if they don't reference the 'this' instance in the lambda statement's scope through the scope chain,
		// but instead assign that value to something like 'self' in the scope where the lambda is declared and then access this value in the lambda body through 'self'.

		// assert that there is no reason to call 'emitDeclaration', because there's no metadata or modifications on this function
		assert(node.findChild(NodeKind.META_LIST) === null);
		assert(node.findChild(NodeKind.MOD_LIST) === null);

		// assume a certain structure for the children
		assert(node.children.length === 3);
		assert(node.children[0].kind === NodeKind.PARAMETER_LIST);
		assert(
			node.children[1].kind === NodeKind.VECTOR ||
			node.children[1].kind === NodeKind.TYPE
		);
		assert(node.children[2].kind === NodeKind.BLOCK);

		let parameterList = node.children[0];
		let returnType = node.children[1];
		let functionBody = node.children[2];

		emitter.catchup(node.start);

		if (node.parent.kind === NodeKind.BLOCK) {
			let functionName = node.text;
			assert(functionName != null);
			emitter.insert(`let ${functionName} = `);
		} else if (node.text != null) {
			// this function, whose definition doesn't not appear as a statement, has a name
			// which means we have a possible recursive lambda (which we can't easily replace with a fat arrow function,
			// because we need to generate a statement to assign a name to this lambda, and this fat arrow function doesn't appear at a statement level, make it harder to figure out where to put the statement)

			// search for the function's name within the function body to see if this function might be recursive
			let functionName = node.text;
			let functionBodySource = emitter.sourceBetween(
				functionBody.start,
				functionBody.end
			);
			let functionMightBeRecursive = new RegExp(
				String.raw`\b${functionName}\b`
			).test(functionBodySource);
			assert(
				!functionMightBeRecursive,
				`Lambda function named ${node.text} appears to be recursive, so replacing it with a fat-arrow function would be an error`
			);
		}

		emitter.withScope(getFunctionDeclarations(emitter, node), () => {
			emitter.consume(Keywords.FUNCTION, parameterList.start);
			// skip all whitespace appearing after Keywords.FUNCTION
			while (
				/\s/.test(
					emitter.sourceBetween(emitter.index, emitter.index + 1)
				)
			) {
				emitter.skip(1);
			}
			emitter.skipTo(parameterList.start);
			visitNode(emitter, parameterList);
			visitNode(emitter, returnType);
			emitter.catchup(returnType.end);
			// avoid keeping whitespace between return type and function body because TypeScript complains if there's a newline directly preceding the '=>'
			emitter.skipTo(functionBody.start);
			emitter.insert(' => ');
			visitNode(emitter, functionBody);
		});
	} else {
		emitDeclaration(emitter, node);
		emitter.withScope(getFunctionDeclarations(emitter, node), () => {
			let rest = node.getChildFrom(NodeKind.MOD_LIST);
			let blockNode = node.findChild(NodeKind.BLOCK);
			emitter.skipNewLines = true;
			for (var i = 0; i < rest.length; i++) {
				var childNode: Node = rest[i];

				if (childNode.kind == NodeKind.PARAMETER_LIST) {
					let params = childNode.children;
					emitter.consume(Keywords.FUNCTION, childNode.end);


				}

				if (childNode.kind == NodeKind.TYPE) {

					let blockChildren = childNode.children;


				}
				for (var j = childNode.start; j < childNode.end; j++) {
					let char: string = emitter.source.substr(j, 1);
					//emitter.insert("\n" + NodeKind[childNode.kind] + ")" + j + ")" + char.charCodeAt(0) + ":" + char);

				}

				visitNode(emitter, childNode);


				if (childNode.kind == NodeKind.TYPE) {
					emitter.insert(" => ");
				}


			}
			emitter.skipNewLines = true;

		});
    }
}

function emitForIn(emitter: Emitter, node: Node): void {
	let initNode = node.children[0];
	let varNode = initNode.children[0];
	let inNode = node.children[1];
	let blockNode = node.children[2];
	let nameTypeInitNode = varNode.findChild(NodeKind.NAME_TYPE_INIT);
	let typeStr = "";
	if (nameTypeInitNode) {
		// emit variable type on for..of statements, but outside of the loop header.
		let nameNode = nameTypeInitNode.findChild(NodeKind.NAME);
		let typeNode = nameTypeInitNode.findChild(NodeKind.TYPE);
		if (typeNode) {
			emitter.catchup(node.start);
			/*            let typeRemapped = emitter.getTypeRemap(typeNode.text) || typeNode.text;
			 emitter.insert(`let ${ nameNode.text }:${ typeRemapped };\n`);*/

			let typeRemapped = emitter.getTypeRemap(typeNode.text) || typeNode.text;
			typeStr = typeRemapped == undefined ? '' : ':' + typeRemapped;
			emitter.insert(`var ${ nameNode.text }${ typeStr };\n`);
		}
		else {
			let vecNode = nameTypeInitNode.findChild(NodeKind.VECTOR);
			if (vecNode) {
				if (WARNINGS >= 1) {
					console.log("emitter.ts: *** WARNING *** for iterators of type vector not supported. Please declare iterator outside of the for's header");
				}
			}
		}
		emitter.catchup(node.start + Keywords.FOR.length + 1);
		emitter.catchup(varNode.start);
		emitter.insert(`${ nameNode.text }`);
		emitter.skipTo(varNode.end);
	} else {
		emitter.catchup(node.start + Keywords.FOR.length + 1);
		visitNode(emitter, initNode);
	}

	emitter.catchup(inNode.start);
	emitter.insert(' ');
	/*    emitter.skip(Keywords.IN.length + 1); // replace "in " with "of "
	 emitter.insert('of ');*/

	visitNode(emitter, inNode);
	visitNode(emitter, blockNode);
}

if (objNode.kind == NodeKind.ARRAY) {
		emitter.catchup(objNode.start);
		emitter.insert(` ${FOR_IN_OBJ}${emitter.loopObjectCounter} = `);
	}
	visitNodes(emitter, inNode.children);
	emitter.catchup(blockNode.start + 1);

	let def = emitter.findDefInScope(nameNode.text);
	if (def.type && castStr == "" ){
		castStr = `<${def.type.toString()}>`;
	}
	let declarationWord:string = "";
	if (nameTypeInitNode) {
		declarationWord = "var ";
		//emitter.declareInScope({name:nameNode.text});

	}
	else {
		if (def) {
			if (def.bound) {
				declarationWord = def.bound + ".";
			}
			else {
				declarationWord = "";
			}
		}
		else {
			declarationWord = "this.";
		}
	}



	/*  if(!objNode.text){

	 console.log("node", node);
	 }*/

	var obj_name = objNode.text;
	if (objNode.kind == NodeKind.ARRAY) {
		//TODO check nested object
		emitter.insert(`\n\t\t\t${ declarationWord }${ nameNode.text }${ typeStr } =${ castStr }  ${ FOR_IN_OBJ }${emitter.loopObjectCounter}[${ FOR_IN_KEY }];\n`);

	}
	else{

		if (objNode.children.length > 0 && obj_name == undefined) {
			obj_name = getNodeNameRecursive(objNode);
		}

		emitter.insert(`\n\t\t\t${ declarationWord }${ nameNode.text }${ typeStr } = ${ castStr }`);
		let lastIndex:number = emitter.getIndex();
		let inNodeChild = inNode.children[0];
		emitter.skipTo(inNode.start);
		emitter.consume("in", inNodeChild.start);
		visitNode(emitter, inNode);
		emitter.catchup(inNode.end);
		emitter.skipTo(lastIndex);
		emitter.insert (`[${ FOR_IN_KEY }];\n`);

	}

	visitNode(emitter, blockNode);

}

function getNodeNameRecursive(objNode:Node):string{
	var obj_name = objNode.text;
	if(obj_name != undefined)
		return obj_name;
	obj_name = "";
	if (objNode.children.length > 0) {
		if(objNode.kind==NodeKind.CALL) {
			for (var i = 0; i < objNode.children.length; i++) {
				obj_name += getNodeNameRecursive(objNode.children[i]);
				if (i < objNode.children.length - 2) {
					obj_name += ".";
				}
				else if (i == objNode.children.length - 1) {
					return obj_name += "()";
				}
			}
		}
		else if(objNode.kind==NodeKind.ARRAY_ACCESSOR) {
			for (var i = 0; i < objNode.children.length; i++) {
				if (i == objNode.children.length - 1) {
					obj_name += "[";
				}
				obj_name += getNodeNameRecursive(objNode.children[i]);
				if (i < objNode.children.length - 2) {
					obj_name += ".";
				}
				else if (i == objNode.children.length - 1) {
					obj_name += "]";
				}
			}
		}
		else  {
			for (var i = 0; i < objNode.children.length; i++) {
				obj_name += getNodeNameRecursive(objNode.children[i]);
				if (i != objNode.children.length - 1) {
					obj_name += ".";
				}
			}
		}
	}
	return obj_name;
}

function emitBlock(emitter:Emitter, node:Node):void {
	visitNodes(emitter, node.children);
}
function emitMinus(emitter:Emitter, node:Node):void {
	//emitter.insert("-");
	visitNodes(emitter, node.children);
}

function getClassDeclarations(emitter:Emitter, className:string, contentsNode:Node[]):Declaration[] {
	let found:{ [name:string]:boolean } = {};

	let resultDeclarations:Declaration[] = [];
	contentsNode.forEach(node => {

		//let nameNode:Node;
		let nameNodeList:Node[];

		switch (node.kind) {
			case NodeKind.SET:
			case NodeKind.GET:
			case NodeKind.FUNCTION:
				//nameNode = node.findChild(NodeKind.NAME);
				nameNodeList = node.findChildren(NodeKind.NAME);
				break;
			case NodeKind.VAR_LIST:
			case NodeKind.CONST_LIST:
				//nameNode = node.findChild(NodeKind.NAME_TYPE_INIT).findChild(NodeKind.NAME);
				nameNodeList = node.findChildren(NodeKind.NAME_TYPE_INIT)
				break;
			default:
				break;
		}
		if (!nameNodeList || nameNodeList.length == 0)
		{
			return null;
		}
		let modList = node.findChild(NodeKind.MOD_LIST);
		let isStatic = modList && modList.children.some(mod => mod.text === 'static');

		nameNodeList.forEach(nodeInit =>{
				let nameNode:Node = nodeInit.kind == NodeKind.NAME_TYPE_INIT ? nodeInit.findChild(NodeKind.NAME) : nodeInit;
				let typeNode:Node = nodeInit.kind == NodeKind.NAME_TYPE_INIT ? nodeInit : node.findChild(NodeKind.NAME_TYPE_INIT);
				if (!nameNode || found[nameNode.text]) {
					return null;
				}
				found[nameNode.text] = true;
				if (nameNode.text === className) {
					return;
				}

				let declaration = <Declaration>{
					name: nameNode.text,
					type: getDeclarationType(emitter, typeNode),
					bound: isStatic ? className : 'this'
				};
				resultDeclarations.push(declaration);
			}

		)



	})
	resultDeclarations = resultDeclarations.filter(el => !!el);
	return resultDeclarations;
}


/*function getClassDeclarations(emitter: Emitter, className: string, contentsNode: Node[]): Declaration[] {
	let found: { [name: string]: boolean } = {};

	return contentsNode.map(node => {
		let nameNode: Node;

		switch (node.kind) {
			case NodeKind.SET:
			case NodeKind.GET:
			case NodeKind.FUNCTION:
				nameNode = node.findChild(NodeKind.NAME);
				break;
			case NodeKind.VAR_LIST:
			case NodeKind.CONST_LIST:
				nameNode = node.findChild(NodeKind.NAME_TYPE_INIT).findChild(NodeKind.NAME);
				break;
			default:
				break;
		}
		if (!nameNode || found[nameNode.text]) {
			return null;
		}
		found[nameNode.text] = true;
		if (nameNode.text === className) {
			return;
		}

		let modList = node.findChild(NodeKind.MOD_LIST);
		let isStatic = modList && modList.children.some(mod => mod.text === 'static');
		return {
			name: nameNode.text,
			type: getDeclarationType(emitter, node.findChild(NodeKind.NAME_TYPE_INIT)),
			bound: isStatic ? className : 'this'
		};
	}).filter(el => !!el);
            let modList = node.findChild(NodeKind.MOD_LIST);
            let isStatic =
                modList && modList.children.some(mod => mod.text === 'static');
            return {
                name: nameNode.text,
                type: getDeclarationType(
                    emitter,
                    node.findChild(NodeKind.NAME_TYPE_INIT)
                ),
                bound: isStatic ? className : 'this'
            };
        })
        .filter(el => !!el);
}*/

function emitClass(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	visitNode(emitter, node.findChild(NodeKind.META_LIST));
	let mods = node.findChild(NodeKind.MOD_LIST);
	if (mods && mods.children.length) {
		emitter.catchup(mods.start);
		emitter.insert("\n@classBound\n");
		let insertExport = false;
		mods.children.forEach(node => {
			if (node.text !== 'private') {
				insertExport = true;
			}
			emitter.skipTo(node.end);
		});
		if (insertExport) {
			emitter.insert('export');
		}
	}

	//let interfaces:string[] = [];
	let name = node.findChild(NodeKind.NAME);
	let content = node.findChild(NodeKind.CONTENT);
	let contentsNode = content && content.children;
	if (!contentsNode) {
		return;
	}


	// ensure extends identifier is being imported
	let extendsNode = node.findChild(NodeKind.EXTENDS);
	if (extendsNode) {
		emitIdent(emitter, extendsNode);
		emitter.isExtended = true;
		ClassList.addExtendToLast(extendsNode.text);
		emitter.ensureImportIdentifier(extendsNode.text);

	} else {
		emitter.isExtended = false;
	}

	// ensure implements identifiers are being imported
	let implementsNode = node.findChild(NodeKind.IMPLEMENTS_LIST);
	if (implementsNode) {
		implementsNode.children.forEach((node) => {emitter.ensureImportIdentifier(node.text);
			ClassList.addInterfaceToLast(node.text);
		})
	}

	emitter.withScope(getClassDeclarations(emitter, name.text, contentsNode), scope => {
		scope.className = name.text;
		let isInterfaceLinkPrinted:boolean = false;
		contentsNode.forEach(node => {
			visitNode(emitter, node.findChild(NodeKind.META_LIST));
			emitter.catchup(node.start);
			if (isInterfaceLinkPrinted == false) {
				//if (implementsNode) emitter.insert(`static ${INTERFACE_INF};\n`);
				if (implementsNode) {
					let classesList = ""
					implementsNode.children.forEach((node) => {

						classesList += `"${node.text}", `;
					});
					classesList = classesList.substring(0, classesList.length - 2);
					//emitter.insert(`\n${name.text}.${INTERFACE_INF} = [${classesList}];`);
					emitter.insert(`static ${INTERFACE_INF} = [${classesList}];\n`);
				}
				isInterfaceLinkPrinted = true;
			}
			// console.log(node)
			storeClassMember(node);
			switch (node.kind) {
				case NodeKind.SET:
					emitSet(emitter, node);
					break;
				case NodeKind.GET:
					emitGet(emitter, node);
					break;
				case NodeKind.FUNCTION:
					emitMethod(emitter, node);
					break;
				case NodeKind.VAR_LIST:
					emitPropertyDecl(emitter, node);
					break;
				case NodeKind.CONST_LIST:
					emitPropertyDecl(emitter, node, true);
					break;
				default:
					visitNode(emitter, node);
			}
		});

		let pathToRoot = ClassList.getLastPathToRoot();
		emitter.ensureImportIdentifier("classBound", `${pathToRoot}classBound`);
	});

	emitter.catchup(node.end);

}

function storeClassMember(node: Node): void {
	let modeListNode = node.findChild(NodeKind.MOD_LIST);
	let isStatic: boolean = false;
	let isOverridden: boolean = false;
	let nsModifier: number = 0;
	if (modeListNode) {
		let modifiers = modeListNode.findChildren(NodeKind.MODIFIER);
		modifiers.forEach((mode) => {

			if (mode.text == Keywords.STATIC) isStatic = true;
			if (mode.text == Keywords.OVERRIDE) isOverridden = true;
			nsModifier = MODIFIERS[mode.text];
			//if (mode.text == Keywords.PUBLIC || )
		});
	}
	let nameNode: Node;
	let typeNode: Node;

	let namesInitList: Node[];

	switch (node.kind) {
		case NodeKind.SET:
		case NodeKind.GET:
		case NodeKind.FUNCTION:
			nameNode = node.findChild(NodeKind.NAME);
			typeNode = node.findChild(NodeKind.TYPE);
			break;
		case NodeKind.VAR_LIST:
		case NodeKind.CONST_LIST:
			let nameInitNode = node.findChild(NodeKind.NAME_TYPE_INIT);
			namesInitList = node.findChildren(NodeKind.NAME_TYPE_INIT);
			if (nameInitNode) {
				nameNode = nameInitNode.findChild(NodeKind.NAME);
				typeNode = nameInitNode.findChild(NodeKind.TYPE);
			}
			break;
		default:
			return;
	}
	if (namesInitList && namesInitList.length > 1) {

		for (var i = 0; i < namesInitList.length; i++) {
			let nameInitNode = namesInitList[i]
			if (nameInitNode) {
				nameNode = nameInitNode.findChild(NodeKind.NAME);
				typeNode = nameInitNode.findChild(NodeKind.TYPE);
				processClassMember(node, nameNode, typeNode, nsModifier, isStatic, isOverridden);
			}
		}
	}
	else {
		processClassMember(node, nameNode, typeNode, nsModifier, isStatic, isOverridden);
	}


}

function processClassMember(node: Node, nameNode: Node, typeNode: Node, nsModifier: number, isStatic: boolean, isOverridden: boolean): void {
	let classMemberKind: number = 0;
	switch (node.kind) {
		case NodeKind.SET:
			classMemberKind = ClassMemberKind.SET;
			break;
		case NodeKind.GET:
			classMemberKind = ClassMemberKind.GET;
			break;
		case NodeKind.FUNCTION:
			classMemberKind = ClassMemberKind.METHOD;
			break;
		case NodeKind.VAR_LIST:
			classMemberKind = ClassMemberKind.VARIABLE;
			break;
		case NodeKind.CONST_LIST:
			classMemberKind = ClassMemberKind.CONST;
			break;
	}

	if (nameNode) {
		let typeStr = typeNode && typeNode.text ? typeNode.text : "";
		let classMember: ClassMember = new ClassMember(nameNode.text, ClassMemberKind.VARIABLE, typeStr);
		classMember.nsModifier = nsModifier ? nsModifier : ModifierKind.PROTECTED;
		classMember.isStatic = isStatic;
		classMember.isOverridden = isOverridden;
		classMember.kind = classMemberKind;
		if (isStatic) {
			ClassList.addStaticMemberToLast(classMember);
		}
		else {
			ClassList.addClassMemberToLast(classMember);
		}
		//console.log("***<" + nameNode.text +  ":" + typeStr + "/" + classMember.nsModifier  + "/isStatic:" + isStatic + "/isOverride:" + isOverride + ">***");


	}

}


function emitSet(emitter: Emitter, node: Node): void {
	emitClassField(emitter, node);

	let name = node.findChild(NodeKind.NAME);
	emitter.consume('function', name.start);

	let params = node.findChild(NodeKind.PARAMETER_LIST);
	visitNode(emitter, params);
	emitter.catchup(params.end);

	let type = node.findChild(NodeKind.TYPE);
	if (type) {
		emitter.skipTo(type.end);
	}

	emitter.withScope(getFunctionDeclarations(emitter, node), () => {
		visitNodes(emitter, node.getChildFrom(NodeKind.TYPE));
	});
}

function emitConstList(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	let nameTypeInit = node.findChild(NodeKind.NAME_TYPE_INIT);
	emitter.skipTo(nameTypeInit.start);
	emitter.insert('const ');
	visitNode(emitter, nameTypeInit);
}

function emitObjectValue(emitter: Emitter, node: Node): void {
	visitNodes(emitter, node.children);
}

// returns 'true' or 'false', based on whether or not the chain of parents from 'node' on upwards
// have 'kind' values that match the array of kind values given (starting from index 0 on up)
function parentChainHasKinds(node: Node, arrayOfKinds: number[]): boolean {
	if (arrayOfKinds.length === 0 || node === null) {
		return true;
	} else {
		if (node.parent.kind !== arrayOfKinds[0]) {
			return false;
		} else {
			return parentChainHasKinds(node.parent, arrayOfKinds.slice(1));
		}
	}
}

function emitNameTypeInit(emitter: Emitter, node: Node): void {
	emitter.declareInScope({
		name: node.findChild(NodeKind.NAME).text,
		type: getDeclarationType(emitter, node)
	});
	emitter.catchup(node.start);

	assert(node.children[0].kind === NodeKind.NAME);
    assert(node.children[1].kind === NodeKind.TYPE || node.children[1].kind === NodeKind.VECTOR);
    assert(node.children.length === 2 || (node.children.length === 3 && node.children[2].kind === NodeKind.INIT));
    
    let nameNode = node.children[0];
    let typeNode = node.children[1];
    let initNode = node.children[2] || null;

    // we need to know whether or not we're emitting an init statement on a function declaration on an interface,
    // because such functions can't have initialization expressions, and so we need to skip this 'init' expression and add a '?' to the arg name to denote that it's optional
    let isParameterOnInterfaceFunction = false;

    if (parentChainHasKinds(node, [NodeKind.PARAMETER, NodeKind.PARAMETER_LIST, NodeKind.TYPE, NodeKind.CONTENT, NodeKind.INTERFACE])) {
        if (node.getParentChain().filter(ancestor => ancestor.kind === NodeKind.TYPE)[0].text === 'function') {
            isParameterOnInterfaceFunction = true;
        }
    }
    
    visitNode(emitter, nameNode);
    
    if (isParameterOnInterfaceFunction && initNode) {
        emitter.catchup(nameNode.end);
        emitter.insert('?');
    }
    
    visitNode(emitter, typeNode);
    
    if (initNode) {
        if (isParameterOnInterfaceFunction) {
            emitter.commentNode(initNode, false);
        } else {
            visitNode(emitter, initNode);
        }
    }
	visitNodes(emitter, node.children);
}

function emitMethod(emitter:Emitter, node:Node):void {
	var isConstructor:boolean = false;
	let name = node.findChild(NodeKind.NAME);
	if (node.kind !== NodeKind.FUNCTION || name.text !== emitter.currentClassName) {
		let pathToRoot = ClassList.getLastPathToRoot();
		emitter.ensureImportIdentifier("bound", `${pathToRoot}bound`);
		let mods = node.findChild(NodeKind.MOD_LIST);
		if (mods)
			emitter.catchup(mods.start);
		else
			emitter.catchup(name.start);
		emitter.insert("@bound\n");
		emitClassField(emitter, node);
		emitter.consume('function', name.start);
		emitter.catchup(name.end);
		//emitter.insert(" = ");

	} else {
		let mods = node.findChild(NodeKind.MOD_LIST);
		if (mods) {
			emitter.catchup(mods.start);
		}
		emitter.insert('constructor');
		isConstructor = true;

		// Check if the class extends an Array, in which an insertion
		// is required in the constructor. It's a weird
		// case but necessary.
		if (emitter.output.indexOf('extends Array') > -1) {

			// Prepare the injection.
			var className = name.text;
			var injection = '\nvar thisAny:any=this;\nthisAny.__proto__ = ' + className + '.prototype;\n';

			// Find position of insertion.
			// Enter child nodes and process 1 by 1...
			emitter.withScope(getFunctionDeclarations(emitter, node), () => {
				emitter.skipTo(name.end);
				var children = node.getChildFrom(NodeKind.NAME);
				for (var i:number = 0; i < children.length; i++) {
					var child = children[i];
					if (child.kind !== NodeKind.BLOCK) { // visit all other nodes normally
						visitNode(emitter, child);
						// emitter.skipTo(child.end);
					}
					else { // treat block node differently
						// Find super()
						for (var j:number = 0; j < child.children.length; j++) {
							var grandChild = child.children[j];
							visitNode(emitter, grandChild);
							emitter.catchup(grandChild.end + 1);
							if (containsSuperCall(grandChild)) {
								emitter.insert(injection);
							}
						}
					}
				}
			});

			return;
		}
		else {
			emitter.skipTo(name.end);
		}

		// // find "super" on constructor and move it to the beginning of the
		// // block
		// let blockNode = node.findChild(NodeKind.BLOCK);
		// let blockSuperIndex = -1;
		// for (var i = 0, len = blockNode.children.length; i < len; i++) {
		//     let blockChildNode = blockNode.children[i];
		//     if (blockChildNode.kind === NodeKind.CALL
		//         && blockChildNode.children[0].text === "super") {
		//         blockSuperIndex = i;
		//         break;
		//     }
		// }
		//
		// if (childCalls.length > 0) {
		//     console.log(childCalls)
		//     let superIndex = -1;
		//     childCalls.forEach((child, i) => {
		//         if (child.children[0].text === "super") superIndex = blockNode.children.indexOf(child);
		//     })
		//     console.log("super index:", superIndex)
		// }

	}
	}
	//emitter.catchup(blockNode.start + 1);
	emitter.withScope(getFunctionDeclarations(emitter, node), () => {
		let children = node.getChildFrom(NodeKind.NAME);
		let nameNode = children[0];
		for (var i = 0; i < children.length; i++) {
			let childNode = children[i];
			//var implemented = emitter.scope.parent.parent.declarations[0].name; //can not use because it icludes also imports
			if (childNode.kind == NodeKind.BLOCK) {
				if (isConstructor) {
					if (emitter.isExtended) {
						emitter.catchup(childNode.start + 1);
						if (!containsSuperCall(childNode)) {
							emitter.insert("\n\t\tsuper();");
						}
					}
				}
				else {
					//emitter.insert(" => ");

				}
				visitNode(emitter, childNode);
				/*                if (isConstructor) {
				 let  blockChildren = childNode.children;
				 emitter.insert("super()");
				 let firstChild = blockChildren[0];
				 visitNode(emitter, firstChild);
				 for (var j = 1; j < blockChildren.length; j++) {
				 var blockChild = blockChildren[j];
				 visitNode(emitter, firstChild);
				 }
				 } else {
				 emitter.insert(" => ");
				 visitNode(emitter, childNode);
				 }*/
			}
			else {
				visitNode(emitter, childNode);
			}

		}
		//visitNodes(emitter, node.getChildFrom(NodeKind.NAME));

	});
}

function emitGet(emitter:Emitter, node:Node):void {
	let name = node.findChild(NodeKind.NAME);
	if (node.kind !== NodeKind.FUNCTION || name.text !== emitter.currentClassName) {
		emitClassField(emitter, node);
		emitter.consume('function', name.start);
		emitter.catchup(name.end);
	} else {
		let mods = node.findChild(NodeKind.MOD_LIST);
		if (mods) {
			emitter.catchup(mods.start);
		}
		emitter.insert('constructor');

		// Check if the class extends an Array, in which an insertion
		// is required in the constructor. It's a weird
		// case but necessary.
		if (emitter.output.indexOf('extends Array') > -1) {

			// Prepare the injection.
			var className = name.text;
			var injection = '\nvar thisAny:any=this;\nthisAny.__proto__ = ' + className + '.prototype;\n';

			// Find position of insertion.
			// Enter child nodes and process 1 by 1...
			emitter.withScope(getFunctionDeclarations(emitter, node), () => {
				emitter.skipTo(name.end);
				var children = node.getChildFrom(NodeKind.NAME);
				for (var i:number = 0; i < children.length; i++) {
					var child = children[i];
					if (child.kind !== NodeKind.BLOCK) { // visit all other nodes normally
						visitNode(emitter, child);
						// emitter.skipTo(child.end);
					}
					else { // treat block node differently
						// Find super()
						for (var j:number = 0; j < child.children.length; j++) {
							var grandChild = child.children[j];
							visitNode(emitter, grandChild);
							emitter.catchup(grandChild.end + 1);
							if (containsSuperCall(grandChild)) {
								emitter.insert(injection);
							}
						}
					}
				}
			});

			return;
		}
		else {
			emitter.skipTo(name.end);
		}


	}
	emitter.withScope(getFunctionDeclarations(emitter, node), () => {
		visitNodes(emitter, node.getChildFrom(NodeKind.NAME));
	});
}

function emitBlock(emitter: Emitter, node: Node): void {
    if (parentChainHasKinds(node, [NodeKind.FUNCTION, NodeKind.CONTENT, NodeKind.CLASS]) && node.parent.findChild(NodeKind.NAME).text === emitter.currentClassName) {
        // we're emitting the body of a constructor

        // so ensure there is a call to 'super' in this constructor if and only if this class has a parent class
        let hasParentClass = node.parent.parent.parent.findChild(NodeKind.EXTENDS) !== null;

        let isCallToSuper = (node: Node) =>
            node.kind === NodeKind.CALL &&
            node.children[0].kind === NodeKind.IDENTIFIER &&
            node.children[0].text === 'super';

        if (hasParentClass) {

            // insert a generic call to 'super' if no such call exists

            // search for an already existing call to 'super'
            let callsToSuper = node.children.filter(isCallToSuper);

            assert(callsToSuper.length <= 1);   // should be at most one call to 'super'

            emitter.catchup(node.start);
            
            if (node.children.length > 0) {
                emitter.catchup(node.children[0].start);
            }
            
            if (callsToSuper.length !== 1) {
                let [terminatingCharacter, leftPadding] = /(\n|\{)(.*)?$/.exec(emitter.output).slice(1);
                
                // if we didn't encounter a call to the super constructor, add our own call with 0 args
                // Which also happens to be just what Flash does in this case:
                //      "If flash doesn't detect a call to super() in your child constructor then flash will implicitly call super() before your child's constructor."
                //      https://stackoverflow.com/a/7538926/2969105
                emitter.insert('super();');
                if (terminatingCharacter === '\n') {
                    emitter.insert('\n');
                }
                emitter.insert(leftPadding);
            }

            visitNodes(emitter, node.children);
            
        } else {
            // avoid emitting any call to 'super', but visit all other children normally
            emitter.catchup(node.start);
            node.children.forEach(child => {
                if (isCallToSuper(child)) {
                    emitter.commentNode(child, true);
                } else {
                    visitNode(emitter, child);
                }
            });
        }
    } else {
        // default behavior
        emitter.catchup(node.start);
        visitNodes(emitter, node.children);
    }
}

function emitPropertyDecl(emitter:Emitter, node:Node, isConst = false):void {

	let names = node.findChildren(NodeKind.NAME_TYPE_INIT);
	if (names.length > 1)
	{
		//emitter.insert("<prop:>");
		let typeNode:Node;
		let typeStr:string;
		let lastNameNode = names[names.length -1];
		let type = lastNameNode.findChild(NodeKind.TYPE);
		if (type.text != "") typeNode = type;
		typeStr = typeNode ? `:${typeNode.text}` : "";

		let mods = node.findChild(NodeKind.MOD_LIST);
		let start = node.start;
		names.forEach((nameTypeInit, i) => {
			emitClassField(emitter, node);
			emitter.consume(isConst ? Keywords.CONST : Keywords.VAR, nameTypeInit.start);
			//visitNode(emitter, name);


			emitter.declareInScope({
				name: nameTypeInit.findChild(NodeKind.NAME).text,
				type: getDeclarationType(emitter, node)
			});
			//emitter.catchup(nameTypeInit.start);
			let nameNode:Node = nameTypeInit.children[0];
			//let typeNode:Node = nameTypeInit.children[1];
			//visitNodes(emitter, nameTypeInit.children);
			//emitter.index

			emitter.insert(` ${nameNode.text}`);
			if (typeNode)
			{
				emitter.insert(":");
				emitter.skipTo(typeNode.start);
				visitNode(emitter, typeNode);
				emitter.insert(";\n\t");
			}

			//emitter.insert(`${typeStr};\n\t`);
			emitter.setIndexPos(start);
		})
		//emitter.insert("</prop:>");
		emitter.skipTo(node.nextSibling.start);
	}
	else
	{
		emitClassField(emitter, node);
		names.forEach((nameTypeInit, i) => {
			if (i === 0) {
				emitter.consume(isConst ? Keywords.CONST : Keywords.VAR, nameTypeInit.start);
			}
			visitNode(emitter, nameTypeInit);
		})
	}
}

function emitClassField(emitter: Emitter, node: Node): void {
    let mods = node.findChild(NodeKind.MOD_LIST);
    if (mods) {
        emitter.catchup(mods.start);

        let modifiersToEmit = [
            Keywords.PRIVATE,
            Keywords.PUBLIC,
            Keywords.PROTECTED,
            Keywords.STATIC
        ];

        let mapFromModifiersToTextToEmit: any = {};
        modifiersToEmit.forEach(keyword => {
            mapFromModifiersToTextToEmit[keyword] = keyword;
        });

        // visibility modifiers on related 'get' and 'set' methods must be the same in TypeScript,
        // so if this is a 'get' or a 'set', look for the related method and choose to use the 'most visible' modifier that exists on either of them
        if ((node.kind === NodeKind.GET) || (node.kind === NodeKind.SET)) {
            
            // NOTE: the order of these enums completely decides the priority of Visibility settings, higher values overtaking lower values (i.e. Public preferred over Private)
            enum Visibility {
                Private,
                Protected,
                Public,
                NotSpecified    // even though not specifying visibility means a default of 'public' is applied,
                                // this state of not specifying visibility is *not* seen equivalent to specifying 'public',
                                // (when on has to get the visibility of the getter and the setter to be the same)
                                // so we have to account for this extra state
            }
            
            function effectiveVisibilityFromModList(modList: Node): Visibility {
                if (modList !== null) {
                    if (modList.children.findIndex(node => node.text === Keywords.PRIVATE) !== -1) {
                        return Visibility.Private;
                    } else if (modList.children.findIndex(node => node.text === Keywords.PROTECTED) !== -1) {
                        return  Visibility.Protected;
                    } else if (modList.children.findIndex(node => node.text === Keywords.PUBLIC) !== -1) {
                        return  Visibility.Public;
                    }
                }
                
                return Visibility.NotSpecified;
            }

            function keywordFromSpecifiedVisibility(visibility: Visibility): string {
                if (visibility === Visibility.Public) {
                    return Keywords.PUBLIC;
                } else if (visibility === Visibility.Protected) {
                    return Keywords.PROTECTED;
                } else if (visibility === Visibility.Private) {
                    return Keywords.PRIVATE;
                } else {
                    assert(false);
                }
            }
            
            let effectiveVisibility = effectiveVisibilityFromModList(mods);

            let getIsStatic = hasStaticModifer(node);

            let relatedKind = node.kind === NodeKind.GET ? NodeKind.SET : NodeKind.GET;

            // find all related nodes that appear in the same class, that have the same name, and are the same 'static-ness'
            let relatedNodes = node.parent
                .findChildren(relatedKind)
                .filter(sibling => sibling.text === node.text)
                .filter(sibling => getIsStatic === hasStaticModifer(sibling));

            assert(relatedNodes.length <= 1); // there should be at most one such matching set node

            if (relatedNodes.length > 0) {
                // and if we found a matching related node, possibly use its effective visibility to influence the visibility of this node
                let relatedModList = relatedNodes[0].findChild(NodeKind.MOD_LIST);
                let effectiveVisibilityOfRelatedNode = effectiveVisibilityFromModList(relatedModList);
                
                if (effectiveVisibilityOfRelatedNode > effectiveVisibility) {
                    let newVisibility: string;

                    if (effectiveVisibilityOfRelatedNode === Visibility.NotSpecified) {
                        newVisibility = `/*${keywordFromSpecifiedVisibility(effectiveVisibility)}*/`;
                    } else {
                        newVisibility = keywordFromSpecifiedVisibility(effectiveVisibilityOfRelatedNode);
                    }
                    
                    mapFromModifiersToTextToEmit[Keywords.PRIVATE] = newVisibility;
                    mapFromModifiersToTextToEmit[Keywords.PROTECTED] = newVisibility;
                    mapFromModifiersToTextToEmit[Keywords.PUBLIC] = newVisibility;
                }
            }
        }

        // Need to fix this difference:
        //  ActionScript: 'static' modifier can appear before or after access modifier
        //  TypeScript: 'static' modifier must appear after access modifier
        if (
            mods.children.findIndex(node => node.text === Keywords.STATIC) !==
            -1
        ) {
            // if the 'static' modifier exists
            let modifiersToEmit = mods.children
                .map(node => node.text)
                .filter(modifier =>
                    mapFromModifiersToTextToEmit.hasOwnProperty(modifier)
                );
            let lastModifierToEmit =
                modifiersToEmit[modifiersToEmit.length - 1];
            if (lastModifierToEmit !== Keywords.STATIC) {
                // and the last effective modifier is *not* 'static'
                // then swap the last one with 'static'
                mapFromModifiersToTextToEmit[
                    Keywords.STATIC
                ] = lastModifierToEmit;
                mapFromModifiersToTextToEmit[lastModifierToEmit] =
                    Keywords.STATIC;
            }
        }
		mods.children.forEach(node => {
			emitter.catchup(node.start);
			if (node.text !== Keywords.PRIVATE &&
				node.text !== Keywords.PUBLIC &&
				node.text !== Keywords.PROTECTED &&
				node.text !== Keywords.STATIC) {
				emitter.commentNode(node, false);
			}
			emitter.catchup(node.end);
		});
	}
}

function emitDeclaration(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	visitNode(emitter, node.findChild(NodeKind.META_LIST));
	let mods = node.findChild(NodeKind.MOD_LIST);
	if (mods && mods.children.length) {
		emitter.catchup(mods.start);
		let insertExport = false;
		mods.children.forEach(node => {
			if (node.text !== 'private') {
				insertExport = true;
			}
			emitter.skipTo(node.end);
		});
		assert(insertExport || node.kind !== NodeKind.CLASS);   // assert that no classes have a 'private' modifier (otherwise, the fix below to ensure *all* classes are 'export'ed doesn't work)
		if (insertExport) {
			emitter.insert('export');
		}
	} else if (node.kind === NodeKind.CLASS) {
        // In AS3, public classes are allowed to have public methods return instances of non-public classes,
        // for such code to produce valid TypeScript we have to export all such non-public classes,
        // so forcefully emit 'export ' just before the 'class' declaration
        emitter.catchup(node.findChild(NodeKind.NAME).start);
        let classKeywordOnwards = /class\s+.*?$/.exec(emitter.output)[0];
        emitter.output = emitter.output.slice(0, -classKeywordOnwards.length) + 'export ' + classKeywordOnwards;
    }
}


function emitType(emitter: Emitter, node: Node): void {
	// Don't emit type on 'constructor' functions.
	if (node.parent.kind === NodeKind.FUNCTION) {
		let name = node.parent.findChild(NodeKind.NAME);
		if (name && name.text === emitter.currentClassName) {
			emitter.catchup(node.previousSibling.end);
			emitter.skipTo(node.end);
			return;
		}
	}

	emitter.catchup(node.start);

	if (!node.text) {
		if (node.kind === NodeKind.VECTOR) {
			emitVector(emitter, node);
		}
		return;
	}

	emitter.skipTo(node.end);

	// ensure type is imported
	if (
		GLOBAL_NAMES.indexOf(node.text) === -1 && !emitter.getTypeRemap(node.text) &&
		TYPE_REMAP_VALUES.indexOf(node.text) === -1
	) {
		emitter.ensureImportIdentifier(node.text);
	}

	let typeName = emitter.getTypeRemap(node.text) || node.text;

	emitter.insert(typeName);
}

function emitVector(emitter: Emitter, node: Node): void {
	if (!emitter.isNew) {
		emitter.catchup(node.start);
	}

	let type = node.findChild(NodeKind.TYPE);
	if (!type) {
		type = createNode(NodeKind.TYPE, {
			text: 'any',
			start: node.start,
			end: node.end
		});
		type.parent = node;
	}

	emitter.skipTo(type.start);

	if (!emitter.isNew) {
		emitType(emitter, type);
	}

	emitter.insert('[]');

	emitter.skipTo(node.end);
}

function emitShortVector(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	let vector = node.findChild(NodeKind.VECTOR);
	emitter.insert('Array');
	let type = vector.findChild(NodeKind.TYPE);
	if (type) {
		emitType(emitter, type);
	} else {
		emitter.insert('any');
	}
	emitter.catchup(vector.end);
	emitter.insert('(');
	let arrayLiteral = node.findChild(NodeKind.ARRAY);
	emitArray(emitter, arrayLiteral);
	emitter.insert(')');
	emitter.skipTo(node.end);
}

function emitNew(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.isNew = true;
	emitter.emitThisForNextIdent = false;
	visitNodes(emitter, node.children);
	emitter.isNew = false;
	emitter.emitThisForNextIdent = true;
}

function emitCall(emitter:Emitter, node:Node):void {

	let isNew = emitter.isNew;
	emitter.isNew = false;

	let isRETURNINDEXEDARRAY = false;
	//is RETURNINDEXEDARRAY
	let args = node.findChild(NodeKind.ARGUMENTS);
	if (args){
		let arrayDotNode = args.findChild(NodeKind.DOT);
		if (arrayDotNode) {
			let arrayCNode = arrayDotNode.children[0] as Node;
			let literalNode = arrayDotNode.children[1] as Node;
			if (arrayCNode && arrayCNode && literalNode.text == 'RETURNINDEXEDARRAY') {
				let callDot = node.findChild(NodeKind.DOT);
				if (callDot){
					let identifierNode = callDot.findChild(NodeKind.IDENTIFIER);
					let literalSortNode = callDot.findChild(NodeKind.LITERAL);
					if (identifierNode && literalSortNode && literalSortNode.text == 'sort'){
						//emitter.consume(")", 1);
						emitter.catchup(node.start);
						emitter.skipTo(node.end);
						emitter.insert(`AS3Utils.sortRETURNINDEXEDARRAY(${identifierNode.text})`);
						let pathToRoot = ClassList.getLastPathToRoot();
						emitter.ensureImportIdentifier(AS3_UTIL, `${pathToRoot}${AS3_UTIL}`);
						//emitter.insert("*|*");

						isRETURNINDEXEDARRAY = true;

					}
				}

			}
		}
	}

	if (node.children[0].kind === NodeKind.VECTOR) {
		if (isNew) {
			let vector = node.children[0];
			let args = node.children[1];
			emitter.insert('[');
			if (WARNINGS >= 2 && args.children.length > 0) {
				console.log("emitter.ts: *** MINOR WARNING *** emitCall() => NodeKind.VECTOR with arguments not implemented.");
			}
			emitter.insert(']');
			emitter.skipTo(args.end);

			return;
		}
		else {
			if (isCast(emitter, node)) {
				emitter.catchup(node.start);
				emitter.insert('<');
				const vec:Node = node.findChild(NodeKind.VECTOR);
				visitNodes(emitter, [vec]);
				emitter.insert('>');
				const args:Node = node.findChild(NodeKind.ARGUMENTS);
				emitter.skipTo(args.start);
				visitNodes(emitter, [args]);
				return;
			}
		}
	}
	else {
		if (!isNew && isCast(emitter, node)) {
			const type:Node = node.findChild(NodeKind.IDENTIFIER);
			const args:Node = node.findChild(NodeKind.ARGUMENTS);
			const rtype:string = emitter.getTypeRemap(type.text) || type.text;
			emitter.catchup(node.start);
			if (rtype === "string" || rtype === "number") {
				emitter.catchup(node.start);
			}
			else {
				emitter.insert('<');
				emitter.insert(rtype);
				emitter.insert('>');
				emitter.skipTo(args.start);
				visitNodes(emitter, [args]);
				return;
			}
		}
		else {
			emitter.catchup(node.start);
		}
	}

 	if (isRETURNINDEXEDARRAY == false)visitNodes(emitter, node.children);
}



function isCast(emitter: Emitter, node: Node): boolean {

	if (node.children.length == 0) {
		return false;
	}

	const isVector = node.children[0].kind === NodeKind.VECTOR;
	if (isVector && !emitter.isNew) {
		return true;
	}

	const type: Node = node.findChild(NodeKind.IDENTIFIER);
	if (!type || !type.text) {
		return false;
	}

	const declaration = emitter.findDefInScope(type.text);

	if (declaration) {
		return false;
	}

	// If the declaration is not found in scope, AND
	// starts with an uppercase, consider it a cast.
	// (this is quite vague, but its a start)
	const firstLetter = type.text.substring(0, 1);
	if (firstLetter === firstLetter.toLowerCase()) {
		return false;
	}

	emitter.ensureImportIdentifier(type.text);
	return true;
}

function emitCatch(emitter: Emitter, node: Node): void {
    let exceptionName = node.children[0].text;

    emitter.declareInScope({ name: exceptionName });
    emitter.catchup(node.start);

    // accept the exception's name
    emitter.catchup(node.children[0].end);
    let leftPaddingAtCatch = /\n([ \t]*)[^\n]*$/.exec(emitter.output)[1]; // all whitespace indenting the line that contains 'catch'

    let block: Node = null;
    let exceptionType: Node = null;

    if (node.children[1].kind == NodeKind.TYPE) {
        exceptionType = node.children[1];
        block = node.children[2];
    } else {
        block = node.children[1];
    }

    console.assert(!exceptionType || exceptionType.kind == NodeKind.TYPE);
    console.assert(block.kind == NodeKind.BLOCK);

    if (exceptionType !== null) {
        // skip the variable type, because specifying the type of the exception caught here isn't supported in TypeScript
        emitter.skipTo(exceptionType.end);
    }

    let outputLengthBeforeBlockEmit = emitter.output.length;
    visitNode(emitter, block);

    // to duplicate the behavior in ActionScript of being able to have the 'catch' body gaurded by a type check on the exception type,
    // surround the 'catch' body with an 'if' statement that checks the type of the exception with a call to 'instanceof'
    if (exceptionType !== null) {
        let exceptionTypeName =
            emitter.getTypeRemap(exceptionType.text) || exceptionType.text;
        if (exceptionTypeName === 'any') {
            // don't build an 'if' statement to check for an instance of this type, because all values are of type 'any', so the 'if' will never be false
        } else {
            // Surround the 'catch' body (after giving it an extra level of indentation) with an 'if' that appropriately checks the type of the exception being thrown,
            // and end the 'if' with an 'else' that re-throws the exception in the case where the type didn't match
            emitter.catchup(block.end);
            let blockBeginIndex = emitter.output.indexOf(
                '{',
                outputLengthBeforeBlockEmit
            );
            let emittedBlock = emitter.output.slice(blockBeginIndex + 1);
            emittedBlock = emittedBlock.replace(/\n/g, '\n\t'); // indent the full block an extra level (here we're assuming that 'tabs' are used instead of 'spaces' for indenting)
            let leftPaddingForIfStatement = leftPaddingAtCatch + '\t';

            emitter.output =
                emitter.output.slice(0, blockBeginIndex + 1) +
                `\n${leftPaddingForIfStatement}if (${exceptionName} instanceof `;
            // perform a little hackery to properly emit the exception's type
            let indexBeforeSkip = emitter.index;
            emitter.skipTo(exceptionType.start);
            visitNode(emitter, exceptionType);
            emitter.skipTo(indexBeforeSkip);

            emitter.output +=
                ') {' +
                emittedBlock +
                `\n${leftPaddingForIfStatement}else { throw ${exceptionName}; }\n${leftPaddingAtCatch}}`;
        }
    }
}


function emitRelation(emitter:Emitter, node:Node):void {

	emitter.catchup(node.start);

	// Check for 'as' in relation.
	let as = node.findChild(NodeKind.AS);
	if (as) {
		// TODO: implement relation with type cast to vectors
		//       e.g. (myVector as Vector.<Boolean>)
		if (node.lastChild.kind === NodeKind.IDENTIFIER) {
			emitter.insert('(<');
			let typeText = emitter.getTypeRemap(node.lastChild.text) || node.lastChild.text;

			emitter.insert(typeText);
			emitter.ensureImportIdentifier(typeText);
			emitter.insert('>');
			visitNodes(emitter, node.getChildUntil(NodeKind.AS));
			emitter.catchup(as.start);
			emitter.insert(')');
			emitter.skipTo(node.end);

		} else if (node.lastChild.kind === NodeKind.VECTOR) {
			visitNodes(emitter, node.children);
		} else {
			emitter.commentNode(node, false);
		}
		return;
	}

	// Check for 'is' in relation.
	let is = containsIsKeyword(node);
	if (is) {

		// Determine if the check is against a primitive or a custom type.
		// console.log(node.toString());
		var isPrimitiveCheck:boolean = containsPrimitiveIdentifier(node);
		var isClassCheck:boolean = containsClassIdentifier(node);
		if (isPrimitiveCheck || isClassCheck) {

			// Identify players.
			var varNode = node.children[0];
			var isNode = node.children[1];
			var typeNode = node.children[2];

			// Insert 'typeof' before instance name.
			emitter.catchup(node.start);
			emitter.insert('typeof ');
			// Emit variable name.
			visitNode(emitter, varNode);

			// 80pro hotfix for missing "]"
			if (varNode.kind == NodeKind.ARRAY_ACCESSOR) {
				emitter.insert('] ');
			}

			emitter.skipTo(varNode.end);
			// Emit equality check.
			emitter.insert(' === ');
			//emitter.insert(' instanceof ');

			// Replace type with string comparison.

			let typeRemapped = emitter.getTypeRemap(typeNode.text) || typeNode.text;
			//if (typeRemapped == "number") typeRemapped = "Number";
			//if (typeRemapped == "string") typeRemapped = "String";
			if (isClassCheck) typeRemapped = "function";
			emitter.insert(`'${typeRemapped}'`);
			if (isClassCheck == false) emitter.ensureImportIdentifier(typeRemapped);

			// Skip the rest... 'is Number/String/Boolean'
			emitter.skipTo(node.end);

			return;
		}
		else {
/*			// TODO: custom type interface checks are currently not checked by the compiler
			if (WARNINGS >= 1) {
				console.log("emitter.ts: *** WARNING *** custom type interface checks are currently not treated by the compiler.");
			}*/
			let children = node.children;
			let leftIdent = children[0];
			let castedStr:string;
			let castedComplexNode:Node;
			let arrayAccessorNode:Node;
			if (leftIdent.kind == NodeKind.IDENTIFIER)
			{
				castedStr = leftIdent.text;
			} else
			{
				castedComplexNode = leftIdent;
			}

			let middleNode = children[1];
			let rightIdent = children[2];
			//visitNode(emitter, leftIdent);
			//visitNode(emitter, middleNode);
			let isInterface = ClassList.checkIsInterface(rightIdent.text);
			if (isInterface)
			{
				emitter.insert(`${AS3_UTIL}.${INTERFACE_METHOD}(`);
				if (castedStr){
					emitter.insert(castedStr);
				} else if (castedComplexNode){
					visitNode(emitter, castedComplexNode);
					emitter.catchup(castedComplexNode.end);
				}

				emitter.insert (`, "${rightIdent.text}")`);

				if ((VERBOSE_MASK & ReportFlags.EXT_AST_SHOW_CASTING_INTERFACE) == ReportFlags.EXT_AST_SHOW_CASTING_INTERFACE) {
					console.log(">>>Class: " + ClassList.currentClassRecord.getFullPath() + "; ident: " + castedStr + " casts "  + isInterface.getFullPath());
				}
			}
			else
			{
/*				if (castedStr){
					emitter.insert(castedStr);
				}else if (castedComplexNode){

					visitNode(emitter, castedComplexNode);
					emitter.catchup(castedComplexNode.end);
				}*/

				if (rightIdent.text === 'Class'){

				}
				else
				{

				}
				visitNode(emitter, leftIdent);
				emitter.catchup(leftIdent.end);
				emitter.insert(` instanceof ${rightIdent.text}`);
			}

			emitter.skipTo(node.end);
			let pathToRoot = ClassList.getLastPathToRoot();
			emitter.ensureImportIdentifier(AS3_UTIL, `${pathToRoot}${AS3_UTIL}`);
			return
		}
	}

	visitNodes(emitter, node.children);
}

function containsIsKeyword(node:Node) {
	for (var i:number = 0; i < node.children.length; i++) {
		var child:Node = node.children[i];
		if (child.text == 'is') {
			return true;
		}
	}
	return false;
	;
}

function containsPrimitiveIdentifier(node:Node) {
	for (var i:number = 0; i < node.children.length; i++) {
		var child:Node = node.children[i];
		if (child.kind == NodeKind.IDENTIFIER) {
			if (child.text === 'Number' || child.text === 'String' || child.text === 'Boolean') {
				return true;
			}
		}
	}
	return false;
}
function containsClassIdentifier(node:Node) {
	for (var i:number = 0; i < node.children.length; i++) {
		var child:Node = node.children[i];
		if (child.kind == NodeKind.IDENTIFIER) {
			if (child.text === 'Class') {
				return true;
			}
		}
	}
	return false;
}

function emitOp(emitter:Emitter, node:Node):void {
	emitter.catchup(node.start);
	if (node.text === Keywords.IS) {
		emitter.insert(Keywords.INSTANCE_OF);
		emitter.skipTo(node.end);
		return;
	}
	emitter.catchup(node.end);
}

function emitOr(emitter: Emitter, node: Node): void {
	// // TODO: support for `value ||= 10` expressions;
	// if (node.children.length === 3 && node.children[2].text === "=")
	// {
	//     node.children[2].text = node.children[0].text + " =";
	// }

	emitter.catchup(node.start);
	visitNodes(emitter, node.children);
}

export function identifierHasDefinition(emitter: Emitter, identifier: string) {
	return !(!emitter.findDefInScope(identifier) &&
		emitter.currentClassName &&
		GLOBAL_NAMES.indexOf(identifier) === -1 &&
		!TYPE_REMAP.hasOwnProperty(identifier) &&
		identifier !== emitter.currentClassName);
}

export function emitIdent(emitter: Emitter, node: Node): void {
	if (node.text == "getDefinitionByName") {
		let pathToRoot = ClassList.getLastPathToRoot();
		emitter.ensureImportIdentifier(AS3_UTIL, `${pathToRoot}${AS3_UTIL}`);
	}
	emitter.catchup(node.start);
	let staticRef: ClassRecord;
	if (ClassList.isScanning == false) {
		staticRef = ClassList.checkIsStaticParentMamber(node.text);
		if (staticRef && (VERBOSE_MASK & ReportFlags.EXT_AST_SHOW_PARENT_STATIC) == ReportFlags.EXT_AST_SHOW_PARENT_STATIC) {
			console.log(">>> Static in parent: " + node.text + "  " + staticRef.getFullPath());
		}
		if ((VERBOSE_MASK & ReportFlags.EXT_AST_SHOW_ALL_STATIC) == ReportFlags.EXT_AST_SHOW_ALL_STATIC) {
			let allStatic = ClassList.checkIsStatic(node.text);
			if (allStatic) console.log(">>> Static ref: " + node.text + "  " + allStatic.getFullPath());

		}
		if ((VERBOSE_MASK & ReportFlags.EXT_AST_SHOW_STATIC_VARIABLES) == ReportFlags.EXT_AST_SHOW_STATIC_VARIABLES) {
			let staticVariable = ClassList.checkIsStaticVariable(node.text);
			if (staticVariable) console.log(">>> Static variable: " + node.text + "  " + staticVariable.getFullPath());

		}
	}

	if (node.parent && node.parent.kind === NodeKind.DOT) {
		//in case of dot just check the first
		if (node.parent.children[0] !== node) {
			return;
		}
	}

	if (Keywords.isKeyWord(node.text)) {
		emitter.insert(node.text);
		emitter.skipTo(node.end);
		return;
	}

	let def = emitter.findDefInScope(node.text);
	if (def && def.bound) {
		emitter.insert(def.bound + '.');
	}

	if (!def &&
		emitter.currentClassName &&
		GLOBAL_NAMES.indexOf(node.text) === -1 &&
		TYPE_REMAP[node.text] === undefined &&
		node.text !== emitter.currentClassName
	) {
		if (node.text.match(/^[A-Z]/)) {
			// Import missing identifier from this namespace
			if (!emitter.options.useNamespaces) {
				emitter.ensureImportIdentifier(node.text);
			}

		} else if (emitter.emitThisForNextIdent) {
			// Identifier belongs to `this.` scope.
			emitter.insert('this.');
		}
	}

	node.text = emitter.getIdentifierRemap(node.text) || node.text;

	emitter.insert(node.text);
	// if this identifer represents a parametrized type, which is the direct target of a 'new' statement, append the needed parenthesis
    if (node.text.slice(-1) === '>' && node.parent.kind === NodeKind.NEW) {
        emitter.insert('()');
    }
	emitter.skipTo(node.end);
	emitter.emitThisForNextIdent = true;
}

function emitDot(emitter: Emitter, node: Node) {
	let dotSibling = node.nextSibling;
	let isConditionalCompilation = (dotSibling && dotSibling.kind === NodeKind.BLOCK);
	let template = "if ($1)";

	if (!isConditionalCompilation && node.parent.kind === NodeKind.CONDITION) {
		let separator = emitter.sourceBetween(
            node.children[0].end,
            node.children[0].end + 2
        );
		isConditionalCompilation = separator === '::';
		template = '$1';
	}

	// wrap conditional compilation into Node.js conditional for
	// `process.env.VARIABLE`
	//
	// More info about Flex conditional compilation:
	// http://help.adobe.com/en_US/flex/using/WS2db454920e96a9e51e63e3d11c0bf69084-7abd.html

	if (isConditionalCompilation) {
		emitter.catchup(node.start);
		emitter.insert(template.replace("$1", `process.env.${node.children[1].text.toUpperCase()}`));
		emitter.skipTo(node.end);
		return;

	} else {
		// TODO: allow conditional compilation for function/class definitions

	}

	visitNodes(emitter, node.children);
}

function emitXMLLiteral(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.insert(JSON.stringify(node.text));
	emitter.skipTo(node.end);
}

function emitLiteral(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.insert(node.text);
	emitter.skipTo(node.end);
}

function emitArray(emitter: Emitter, node: Node): void {
	emitter.catchup(node.start);
	emitter.insert('[');
	if (node.children.length > 0) {
		//emitter.skipTo(node.children[0].start);
		emitter.skip(1);
		//emitter.consume("\n", node.children[0].start);
		emitter.consumeRegExp(/\s+(?=\W)/m, node.children[0].start);
		visitNodes(emitter, node.children);
		emitter.catchup(node.lastChild.end);
	}
	emitter.insert(']');
	emitter.skipTo(node.end);
}

export function emit(ast: Node, source: string, options?: EmitterOptions): string {
	let emitter = new Emitter(source, options);
	return emitter.emit(ast);
}

function emitLoopBranch(emitter: Emitter, node: Node): void {
    // The only thing that can be in a break is a label and it shouldn't
    //  need any special treatment.  Just bundle it all up and call it good.
    emitter.catchup(node.end);
}

function emitAssignment(emitter: Emitter, node: Node): void {
     let operation = node.findChild(NodeKind.OP);
    
     if (operation.text === Operators.DOUBLE_AND_EQUAL || operation.text === Operators.DOUBLE_OR_EQUAL) {
         assert(node.children.length === 3);    // not yet coding to handle multiple assignments in a row here

         let lhs =  node.children[0];
         let rhs =  node.children[2];

         emitter.catchup(node.start);
         visitNode(emitter, lhs);
         emitter.catchup(operation.start);
         emitter.insert('=');
         emitter.skipTo(operation.end);
         emitter.catchup(rhs.start);
         
         emitter.skipTo(lhs.start);
         visitNode(emitter, lhs);
         emitter.catchup(lhs.end);
         
         if (operation.text === Operators.DOUBLE_AND_EQUAL) {
             emitter.insert(' && ');
         } else if ( operation.text === Operators.DOUBLE_OR_EQUAL) {
             emitter.insert(' || ');
         } else {
             assert(false);
         }
         
         emitter.skipTo(rhs.start);
         visitNode(emitter, rhs);
         
     } else {
         // default behavior
         emitter.catchup(node.start);
         visitNodes(emitter, node.children);
     }
}
