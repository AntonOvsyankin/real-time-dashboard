import { FieldTree } from '@angular/forms/signals';
import { SettingsModel } from '../../core/settings/settings-schema';

/** One numeric input on the Settings page, rendered by the `@for` in the template. */
export interface SettingsFieldView {
  name: keyof SettingsModel;
  label: string;
  hint: string;
  field: FieldTree<number | null>;
}
