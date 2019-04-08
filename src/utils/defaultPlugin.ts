import { InputOptions, Plugin } from '../rollup/types';
import { error } from './error';
import { lstatSync, readdirSync, readFileSync, realpathSync } from './fs';
import { basename, dirname, isAbsolute, resolve } from './path';

export function getRollupDefaultPlugin(options: InputOptions): Plugin {
	return {
		name: 'Rollup Core',
		resolveId: createResolveId(options),
		load(id) {
			return readFileSync(id, 'utf-8');
		},
		resolveDynamicImport(specifier, parentId) {
			if (typeof specifier === 'string' && !this.isExternal(specifier, parentId, false))
				return <Promise<string>>this.resolveId(specifier, parentId);
		},
		resolveAssetUrl({ relativeAssetPath, format }) {
			return relativeUrlMechanisms[format](relativeAssetPath);
		},
		resolveImportMeta(prop, { chunkId, format }) {
			const mechanism = importMetaUrlMechanisms[format] && importMetaUrlMechanisms[format](chunkId);
			if (mechanism) {
				return prop === null ? `({ url: ${mechanism} })` : prop === 'url' ? mechanism : 'undefined';
			}
		}
	};
}

function findFile(file: string, preserveSymlinks: boolean): string | void {
	try {
		const stats = lstatSync(file);
		if (!preserveSymlinks && stats.isSymbolicLink())
			return findFile(realpathSync(file), preserveSymlinks);
		if ((preserveSymlinks && stats.isSymbolicLink()) || stats.isFile()) {
			// check case
			const name = basename(file);
			const files = readdirSync(dirname(file));

			if (files.indexOf(name) !== -1) return file;
		}
	} catch (err) {
		// suppress
	}
}

function addJsExtensionIfNecessary(file: string, preserveSymlinks: boolean) {
	let found = findFile(file, preserveSymlinks);
	if (found) return found;
	found = findFile(file + '.mjs', preserveSymlinks);
	if (found) return found;
	found = findFile(file + '.js', preserveSymlinks);
	return found;
}

function createResolveId(options: InputOptions) {
	return function(importee: string, importer: string) {
		if (typeof process === 'undefined') {
			error({
				code: 'MISSING_PROCESS',
				message: `It looks like you're using Rollup in a non-Node.js environment. This means you must supply a plugin with custom resolveId and load functions`,
				url: 'https://rollupjs.org/guide/en#a-simple-example'
			});
		}

		// external modules (non-entry modules that start with neither '.' or '/')
		// are skipped at this stage.
		if (importer !== undefined && !isAbsolute(importee) && importee[0] !== '.') return null;

		// `resolve` processes paths from right to left, prepending them until an
		// absolute path is created. Absolute importees therefore shortcircuit the
		// resolve call and require no special handing on our part.
		// See https://nodejs.org/api/path.html#path_path_resolve_paths
		return addJsExtensionIfNecessary(
			resolve(importer ? dirname(importer) : resolve(), importee),
			options.preserveSymlinks
		);
	};
}

const getResolveUrl = (path: string, URL: string = 'URL') => `new ${URL}(${path}).href`;

const getUrlFromDocument = (chunkId: string) =>
	`(document.currentScript && document.currentScript.src || new URL('${chunkId}', document.baseURI).href)`;

const importMetaUrlMechanisms: Record<string, (chunkId: string) => string> = {
	amd: () => getResolveUrl(`module.uri, document.baseURI`),
	cjs: chunkId =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __filename`,
			`(require('u' + 'rl').URL)`
		)} : ${getUrlFromDocument(chunkId)})`,
	iife: chunkId => getUrlFromDocument(chunkId),
	system: () => `module.meta.url`,
	umd: chunkId =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __filename`,
			`(require('u' + 'rl').URL)`
		)} : ${getUrlFromDocument(chunkId)})`
};

const getRelativeUrlFromDocument = (relativePath: string) =>
	getResolveUrl(
		`(document.currentScript && document.currentScript.src || document.baseURI) + '/../${relativePath}'`
	);

const relativeUrlMechanisms: Record<string, (relativePath: string) => string> = {
	amd: relativePath => getResolveUrl(`module.uri + '/../${relativePath}', document.baseURI`),
	cjs: relativePath =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __dirname + '/${relativePath}'`,
			`(require('u' + 'rl').URL)`
		)} : ${getRelativeUrlFromDocument(relativePath)})`,
	es: relativePath => getResolveUrl(`'${relativePath}', import.meta.url`),
	iife: relativePath => getRelativeUrlFromDocument(relativePath),
	system: relativePath => getResolveUrl(`'${relativePath}', module.meta.url`),
	umd: relativePath =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __dirname + '/${relativePath}'`,
			`(require('u' + 'rl').URL)`
		)} : ${getRelativeUrlFromDocument(relativePath)})`
};
