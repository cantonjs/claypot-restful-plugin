import doc from './doc';
import router from './router';
import getConfig from './utils/getConfig';
import spec from './swaggerSpec';
import getRoutes from './utils/getRoutes';
import logger from './utils/logger';
import ensureModels from './utils/ensureModels';

export default class ApiClaypotPlugin {
	constructor(config, claypotConfig) {
		this.config = getConfig(config);
		this.claypotConfig = claypotConfig;
	}

	async willStartServer(app) {
		const { config, claypotConfig } = this;
		const { models } = app;
		app.proxy = true;
		await spec.init(config, claypotConfig);
		this.routes = getRoutes(config, claypotConfig);
		const deref = await spec.genDereferenceAsync();
		ensureModels(models, deref.paths, config);
	}

	middleware(app) {
		const { config, routes } = this;
		if (config.docPath) {
			app.mount(config.docPath, doc(config));
			logger.debug(`doc mounted on "${config.docPath}"`);
		}
		app.mount(config.basePath, router(routes, config));
		logger.debug(`api mounted on "${config.basePath}"`);

		spec.alloc();
	}
}
