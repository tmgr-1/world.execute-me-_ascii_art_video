// Static content registration. Views have no access to terminal or audio output.
import { graphic, hostView } from '../films/world-execute/views.js';
export const filmViews = new Map([['world-execute', { graphic, hostView }]]);
