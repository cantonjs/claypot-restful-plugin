
import mapModules from './utils/mapModules';
import ensureAbsolutePath from './utils/ensureAbsolutePath';
import { forEach, isString, isObject } from 'lodash';
import { logger } from 'claypot';
import SwaggerParser from 'swagger-parser';
import { readJson } from 'fs-extra';
import { join } from 'path';
import fetch from 'node-fetch';

const ensureSecurityField = function ensureSecurityField(spec) {
	if (spec && Array.isArray(spec.security)) {
		spec.security.forEach((security, index) => {
			if (isString(security)) {
				spec.security[index] = { [security]: [] };
			}
		});
	}
	return spec;
};

const ensureResponseField = (spec) => {
	let { responses = {} } = spec;
	const schema = {
		$ref: '#/definitions/DefaultErrorResponse',
	};
	if (!responses[400]) {
		responses[400] = {
			description: 'Payload Error',
			schema,
		};
	}


	// TODO: should only inject 401 when Security is required
	if (!responses[401]) {
		responses[401] = {
			description: 'Access Denied',
			schema,
		};
	}


	spec.responses = responses;
	return spec;
};

const setRefs = function setRefs(spec) {
	if (Array.isArray(spec)) {
		spec = spec.map(setRefs);
	}
	else if (isObject(spec)) {
		spec = Object.keys(spec).reduce((obj, key) => {
			obj[key] = setRefs(spec[key]);
			return obj;
		}, {});
	}
	else if (isString(spec) && spec.startsWith('$')) {
		const ref = spec.slice(1);
		return {
			'$ref': `#/definitions/${ref}`,
		};
	}

	return spec;
};

class Spec {
	async init(config, claypotConfig) {
		this._config = config;
		this._claypotConfig = claypotConfig;
		this._paths = {};
		this._json = null;
		this._securityDefs = null;
		this._dereference = null;
		this.securityNames = [];
		await this._readSpecFile();
	}

	async _readSpecFile() {
		const { spec } = this._config;
		if (isString(spec)) {
			try {
				if (/^https?:\/\//i.test(spec)) {
					const res = await fetch(spec);
					this._json = await res.json();
				}
				else {
					const { root } = this._claypotConfig;
					this._json = await readJson(join(root, spec));
				}
			}
			catch (err) {
				logger.error(`Failed to read spec file: "${spec}"`);
			}
		}
		else if (isObject(spec)) {
			this._json = spec;
		}
	}

	async genDereferenceAsync() {
		if (this._dereference) { return this._dereference; }
		return (this._dereference = await new SwaggerParser().parse(this.toJSON()));
	}

	addPath(name, path, method, data) {
		if (this._json) { return; }

		const paths = this._paths[path] || (this._paths[path] = {});

		if (data.params || data.param) {
			data.parameters = data.params || data.param;
			delete data.params;
			delete data.param;
		}

		if (isObject(data.parameters)) {
			const { parameters } = data;
			data.parameters = Object.keys(parameters).map((name) => {
				const parameter = parameters[name];
				parameter._var = name;
				if (!parameter.name) { parameter.name = name; }
				if (!parameter.in) { parameter.in = 'body'; }
				return parameter;
			});
		}

		const spec = { tags: [name], ...data };
		ensureSecurityField(spec);
		ensureResponseField(spec);
		paths[method] = spec;
	}

	getPath(path, method) {
		try {
			return this._dereference.paths[path][method];
		}
		catch (err) {
			return {};
		}
	}

	_getDefaultSpec() {
		const config = this._config;
		const claypotConfig = this._claypotConfig;

		const info = {
			'version': '1.0.0',
			'title': `${claypotConfig.name} API`,
			...config.info,
		};

		const spec = {
			'swagger': '2.0',
			info,
			'basePath': ensureAbsolutePath(config.basePath),
			'consumes': config.consumes,
			'produces': config.produces,
			'schemes': ['http', claypotConfig.ssl.enable && 'https'].filter(Boolean),
			'paths': {},
			'securityDefinitions': {},
			'definitions': {},
		};

		if (config.defaultSecurity) {
			spec.security = config.defaultSecurity;
			ensureSecurityField(spec);
		}

		return spec;
	}

	getSecurityNames(security) {
		const get = () => {
			if (security && security.length) { return security; }
			return this._dereference.security || [];
		};
		return get().map((o) => Object.keys(o)[0]);
	}

	getSecurityDefs() {
		if (this._securityDefs) { return this._securityDefs; }

		const { securities } = this._config;
		forEach(securities, (name, key) => {
			if (isString(name)) {
				securities[key] = {
					type: 'apiKey',
					in: 'header',
					description: 'Access token',
					name,
				};
			}
		});
		return (this._securityDefs = securities);
	}

	addSecurityParameters(path, method, securities) {
		const pathSpec = this.getPath(path, method);
		const { parameters = [] } = pathSpec;
		securities.forEach((security) => {
			const { name, description } = security;
			const hasExists = parameters.some((param) =>
				param.name === name && param.in === security.in
			);
			if (!hasExists) {
				parameters.push({
					name,
					in: security.in,
					type: 'string',
					description,
				});
			}
		});
	}

	toJSON() {
		if (this._json) { return this._json; }

		const config = this._config;
		const claypotConfig = this._claypotConfig;
		let spec = this._getDefaultSpec();

		const defs = mapModules(config.definitionsPath, claypotConfig.root);
		const builtInDefs = mapModules('defs', __dirname);
		builtInDefs.concat(defs).forEach(({ name, module }) => {
			spec.definitions[name] = module;
		});
		spec.paths = this._paths;
		spec.securityDefinitions = this.getSecurityDefs(config);
		this.securityNames = Object.keys(spec.securityDefinitions);
		spec = setRefs(spec);

		return (this._json = spec);
	}

	alloc() {
		this._dereference = null;
		this._paths = {};
		this._securityDefs = null;
		this._config = {};
		this._claypotConfig = {};
	}
}

export default new Spec();
