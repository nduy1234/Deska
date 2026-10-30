import { defineComponents } from '@iwsdk/core';
import {
  Clay,
  Held,
  Note,
  NotePad,
  Settling,
  Tool,
  TraySlot,
} from './core/components.js';

export default defineComponents([Clay, TraySlot, Held, Settling, Tool, Note, NotePad]);
