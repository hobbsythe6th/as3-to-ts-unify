import Emitter, { visitNode, visitNodes } from '../../emit/emitter';
import NodeKind from '../../syntax/nodeKind';
import Node from '../../syntax/node';

function visit(emitter: Emitter, node: Node): boolean {
    if (node.kind === NodeKind.ASSIGN) {
        const dot = node.children[0];
        if (dot.kind === NodeKind.DOT && dot.children[0].text === 'super') {
            const property = dot.children[1].text;

            emitter.catchup(node.start);
            emitter.insert(
                `super.set${property[0].toUpperCase()}${property.slice(1)}(`
            );
            emitter.skipTo(node.children[2].start);
            visitNode(emitter, node.children[2]);
            emitter.insert(')');
            return true;
        }
    } else if (
        node.kind === NodeKind.DOT &&
        node.parent.kind !== NodeKind.CALL
    ) {
        if (node.children[0].text === 'super') {
            const property = node.children[1].text;

            emitter.catchup(node.start);
            emitter.insert(
                `super.get${property[0].toUpperCase()}${property.slice(1)}()`
            );
            emitter.skipTo(node.end);
            return true;
        }
    }

    return false;
}

export default {
    visit: visit
};
