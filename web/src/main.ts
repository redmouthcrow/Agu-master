import { createApp } from 'vue';
import App from './App.vue';
import WidgetApp from './components/WidgetApp.vue';
import { getAppMode } from './utils/appMode';

const mode = getAppMode();
const root = mode === 'widget' ? WidgetApp : App;

createApp(root).mount('#app');
