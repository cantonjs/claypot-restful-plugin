
import Koa from 'koa';
import koaStatic from 'koa-static';
import { logger } from 'claypot';
import { join } from 'path';
import { readFile } from 'fs-extra';
import { template } from 'lodash';
import getDefaultSpec from './utils/getDefaultSpec';
import mapModules from './utils/mapModules';
import replaceSpecRefs from './utils/replaceSpecRefs';

let tpl;
const readTemplateOnce = async () => {
	if (tpl) { return tpl; }
	else { return readFile(join(__dirname, './doc.html'), 'utf-8'); }
};

export default function doc(specPaths, config, claypotConfig) {
	const app = new Koa();

	let spec = getDefaultSpec(config, claypotConfig);

	const defs = mapModules(config.definitionsPath, claypotConfig.root);
	const builtInDefs = mapModules('defs', __dirname);
	builtInDefs.concat(defs).forEach(({ name, module }) => {
		spec.definitions[name] = module;
	});
	spec.paths = specPaths;
	spec = replaceSpecRefs(spec);

	logger.debug('API spec', spec);

	return app
		.use(async (ctx, next) => {
			if (ctx.request.path === '/') {
				const compiled = template(await readTemplateOnce());
				const html = compiled({
					title: spec.info.title,
					basePath: config.docPath,
					spec: JSON.stringify(spec),
				});
				ctx.type = 'text/html';
				ctx.body = html;
			}
			else {
				await next();
			}
		})
		.use(koaStatic(join(__dirname, '..', 'assets')))
	;
}
