import './style.css';
import { App } from './ui/App';

/**
 * UCCplay entry point: imports the theme and boots the App controller.
 * The module is loaded as a deferred ES module, so the DOM is ready.
 */
const app = new App();
void app.init();
