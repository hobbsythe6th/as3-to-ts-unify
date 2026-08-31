import Node from '../../syntax/node';
import NodeKind from '../../syntax/nodeKind';
import Emitter from '../../emit/emitter';
import {
    producesXmlListValue, getConversionFunctionNameFromTypeScriptType, emitExpressionWithConversion,
    producesXmlOrXmlListValue, getExpressionType
} from './lib';

import emitAssign from './assignment';
import emitFilter from './filter';
import emitIdent from './identifier';
import emitAccessor from './accessors';
import emitDelete from './delete';
import emitLiteral from './literal';
import emitAdd from './add';

import * as assert from 'assert';

function visit(emitter: Emitter, node: Node): boolean {

    let typesExportedFromShim = ["XML", "XMLList", "QName", "Namespace"];
    
    // if this node references one of the types exported by 'e4x_shim', make sure there's an import for this type
    if (node.kind === NodeKind.TYPE || node.kind === NodeKind.IDENTIFIER) {
        if (typesExportedFromShim.indexOf(node.text) !== -1) {
            emitter.ensureImportIdentifier(node.text, "e4x_shim", false);
        }
    } else if (node.kind === NodeKind.RELATION) {
        assert(node.children.length === 3);
        
        if (node.findChild(NodeKind.IS)) {
            if (node.lastChild.kind === NodeKind.IDENTIFIER && typesExportedFromShim.indexOf(node.lastChild.text) !== -1) {
                emitter.ensureImportIdentifier(node.lastChild.text, "e4x_shim", false);
            }
        }
    } else if (node.kind === NodeKind.XML_LITERAL) {
        emitter.ensureImportIdentifier('XML', "e4x_shim", false);
    } else if (node.kind === NodeKind.CALL) {
        if (node.children[0].kind === NodeKind.IDENTIFIER) {
            if (typesExportedFromShim.indexOf(node.children[0].text) !== -1) {
                emitter.ensureImportIdentifier(node.children[0].text, "e4x_shim", false);
            }
        }
    }
    
    if (node.kind === NodeKind.ASSIGN) {
        return emitAssign(emitter, node);
    } else if (node.kind === NodeKind.E4X_FILTER) {
        return emitFilter(emitter, node);
    } else if (node.kind === NodeKind.IDENTIFIER) {
        return emitIdent(emitter, node);
    } else if (node.kind === NodeKind.DELETE) {
        return emitDelete(emitter, node);
    } else if (node.kind === NodeKind.XML_LITERAL) {
        return emitLiteral(emitter, node);
    } else if (node.kind === NodeKind.ADD) {
        return emitAdd(emitter, node);
    } else if (node.kind === NodeKind.INIT) {

        if (node.parent.kind === NodeKind.NAME_TYPE_INIT) {
            assert(node.children.length === 1);

            let expressionNode = node.children[0];

            if (producesXmlOrXmlListValue(emitter, expressionNode)) {

                // ActionScript appears to perform some auto-conversions from XMLList to 'String', 'Number', 'int', 'unit', and 'XML'
                // based on what the type of the receiving variable when doing assignment.
                // So we'll to detect such situations and inject the needed conversions explicitly

                let varTypeNode = node.parent.findChild(NodeKind.TYPE);
                assert(varTypeNode != null);

                let varType = emitter.getTypeRemap(varTypeNode.text) || varTypeNode.text;

                if (varType !== getExpressionType(emitter, expressionNode)) {

                    let conversionFunctionName = getConversionFunctionNameFromTypeScriptType(emitter, varType);

                    if (conversionFunctionName) {
                        emitExpressionWithConversion(emitter, expressionNode, conversionFunctionName);
                        return true;
                    
                    }
                }
            }
        }
    } else if (node.kind === NodeKind.RETURN) {

        if (node.children.length > 0) {
            assert(node.children.length === 1);

            let expressionNode = node.children[0];

            if (producesXmlOrXmlListValue(emitter, expressionNode)) {

                // ActionScript appears to perform some auto-conversions from XMLList to 'String', 'Number', 'int', 'unit', and 'XML'
                // based on what the type of the receiving variable when doing assignment.
                // So we'll to detect such situations and inject the needed conversions explicitly

                let containingFunctionNode = node.getParentChain().filter(ancestor => ancestor.kind === NodeKind.FUNCTION || ancestor.kind === NodeKind.GET)[0];
                assert(containingFunctionNode != null);
                
                let returnTypeNode = containingFunctionNode.findChild(NodeKind.TYPE);
                assert(returnTypeNode != null);
                
                let returnType = emitter.getTypeRemap(returnTypeNode.text) || returnTypeNode.text;
                
                if (returnType !== getExpressionType(emitter, expressionNode)) {
                    let conversionFunctionName = getConversionFunctionNameFromTypeScriptType(emitter, returnType);

                    if (conversionFunctionName) {
                        emitExpressionWithConversion(emitter, expressionNode, conversionFunctionName);
                        return true;
                    }
                }
            }
        }
    } else {
        return emitAccessor(emitter, node);
    }
}

export default {
    visit: visit
};
