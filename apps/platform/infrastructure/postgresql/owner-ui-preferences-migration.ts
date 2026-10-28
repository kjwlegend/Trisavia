import {BASE_MODELS} from './model.ts';
const paths=BASE_MODELS.find(model=>model.logical==='owners')!.fields.map(field=>field.path).concat('uiLocale','uiPreferencesVersion','uiPreferencesUpdatedAt');
/** Only explicit human display preferences. Existing account/authentication fields and applied DDL are untouched. */
export const OWNER_UI_PREFERENCES_MIGRATION={moduleId:'iam',version:8,name:'owner_human_interface_preferences',dependencies:['iam'],sql:`
ALTER TABLE iam.human_accounts
 ADD COLUMN ui_locale text COLLATE "C" CHECK(ui_locale IN ('zh-CN','en')),
 ADD COLUMN ui_preferences_version bigint CHECK(ui_preferences_version BETWEEN 1 AND 9007199254740991),
 ADD COLUMN ui_preferences_updated_at timestamptz CHECK(ui_preferences_updated_at >= '1970-01-01'::timestamptz),
 ADD CONSTRAINT human_accounts_ui_preferences_complete CHECK(
  (ui_locale IS NULL AND ui_preferences_version IS NULL AND ui_preferences_updated_at IS NULL) OR
  (ui_locale IS NOT NULL AND ui_preferences_version IS NOT NULL AND ui_preferences_updated_at IS NOT NULL));
ALTER TABLE iam.human_accounts DROP CONSTRAINT human_accounts__present_check;
ALTER TABLE iam.human_accounts ADD CONSTRAINT human_accounts__present_check CHECK(_present <@ ARRAY[${paths.map(path=>"'"+path+"'").join(',')}]::text[]);
`};
