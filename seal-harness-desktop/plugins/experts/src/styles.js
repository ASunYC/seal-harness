// 来源：Stratex 070ba39e82a4d47dec812870b691eedcb7f7b28e，AgentsView、ExpertEditorView 与 components/experts。
import { dialogStyles } from "../../connectors/src/dialog.jsx"
export const styles = dialogStyles + `
 .zz-experts .expert-card__identity { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.zz-experts .expert-card__identity:hover h3 { text-decoration: underline; }
.zz-experts .expert-card { display: flex; min-height: 154px; flex-direction: column; gap: var(--sp-3); padding: var(--card-pad); border: var(--bw) solid var(--line-weak); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-1); animation: zz-expert-card-in var(--d-flow) var(--spring-smooth) backwards; transition: transform var(--d-pop) var(--spring-smooth), border-color var(--d-pop) var(--spring-smooth), box-shadow var(--d-pop) var(--spring-smooth); }
@keyframes zz-expert-card-in { from { opacity: 0; transform: translateY(7px) scale(0.985); pointer-events: none; }
99% { pointer-events: none; }
to { opacity: 1; transform: none; }
}
.zz-experts .expert-card:hover { transform: translateY(-2px); border-color: var(--line-strong); box-shadow: var(--sh-2); }
.zz-experts .expert-card__head { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
.zz-experts .expert-card__avatar { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: var(--r-pill); color: var(--accent-text); background: var(--accent-soft); font-weight: var(--fw-title); }
.zz-experts .expert-card__identity { min-width: 0; flex: 1; }
.zz-experts .expert-card__identity h3 { margin: 0; overflow: hidden; font-size: var(--fs-400); font-weight: var(--fw-title); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .expert-card__identity p { margin: var(--sp-1) 0 0; color: var(--muted2); font-size: var(--fs-100); white-space: nowrap; }
.zz-experts .expert-card__tools { display: flex; width: 100%; align-items: center; justify-content: flex-end; gap: var(--sp-2); margin-top: auto; padding-top: var(--sp-3); border-top: var(--bw) solid var(--line); }
.zz-experts .expert-card__copy, .zz-experts .expert-card__summon, .zz-experts .expert-card__install { height: var(--ctl-h-sm); padding: 0 var(--sp-3); border: 0; border-radius: var(--r-sm); font: inherit; font-weight: var(--fw-label); cursor: pointer; }
.zz-experts .expert-card__copy { color: var(--ink); background: var(--sunken); }
.zz-experts .expert-card__copy:hover:not(:disabled) { background: var(--line-weak); }
.zz-experts .expert-card__summon { color: var(--btn-p-fg); background: var(--btn-p-bg); }
.zz-experts .expert-card__install { color: var(--accent-text); background: var(--accent-soft); }
.zz-experts .expert-card__copy:disabled, .zz-experts .expert-card__summon:disabled, .zz-experts .expert-card__install:disabled { cursor: not-allowed; opacity: 0.55; }
.zz-experts .expert-card__desc { display: -webkit-box; min-height: 40px; margin: 0; overflow: hidden; color: var(--muted2); font-size: var(--fs-200); line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.zz-experts .expert-badge { padding: var(--sp-1) var(--sp-2); border-radius: var(--r-pill); font-size: var(--fs-100); }
.zz-experts .expert-badge[data-badge='usable'] { color: var(--accent-text); background: var(--accent-soft); }
.zz-experts .expert-badge[data-badge='uploaded'] { color: var(--ok-text, var(--accent-text)); background: var(--ok-soft, var(--sunken)); }
.zz-experts .expert-card__tags { display: flex; min-height: 22px; flex-wrap: wrap; gap: var(--sp-2); }
.zz-experts .expert-card__tags span { padding: var(--sp-1) var(--sp-2); border-radius: var(--r-sm); color: var(--muted2); background: var(--sunken); font-size: var(--fs-100); }
.zz-experts .personal-expert-card { display: flex; min-height: 190px; flex-direction: column; gap: var(--sp-3); padding: var(--card-pad); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-1); animation: zz-expert-card-in var(--d-flow) var(--spring-smooth) backwards; transition: transform var(--d-pop) var(--spring-smooth), border-color var(--d-pop) var(--spring-smooth), box-shadow var(--d-pop) var(--spring-smooth); }
.zz-experts .personal-expert-card:hover { transform: translateY(-2px); border-color: var(--line-strong); box-shadow: var(--sh-2); }
.zz-experts .personal-expert-card__header { position: relative; display: flex; align-items: center; gap: var(--sp-3); }
.zz-experts .personal-expert-card__avatar { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: var(--r-pill); color: var(--accent-text); background: var(--accent-soft); font-weight: var(--fw-title); }
.zz-experts .personal-expert-card__identity { min-width: 0; flex: 1; }
.zz-experts .personal-expert-card__identity h3, .zz-experts .personal-expert-card__identity p, .zz-experts .personal-expert-card__desc { margin: 0; }
.zz-experts .personal-expert-card__identity h3 { overflow: hidden; font-size: var(--fs-400); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .personal-expert-card__identity p { color: var(--muted2); font-size: var(--fs-100); }
.zz-experts .personal-expert-card__badges { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: var(--sp-1); }
.zz-experts .personal-expert-card__more { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: var(--r-sm); color: var(--muted2); background: transparent; cursor: pointer; }
.zz-experts .personal-expert-card__more:hover, .zz-experts .personal-expert-card__more[aria-expanded='true'] { color: var(--ink); background: var(--sunken); }
.zz-experts .personal-expert-card__menu { display: grid; width: 168px; padding: var(--sp-1); border: var(--bw) solid var(--line); border-radius: var(--r-md); background: var(--raised); box-shadow: var(--sh-3, 0 16px 40px rgb(0 0 0 / 18%)); pointer-events: auto; }
.zz-experts .personal-expert-card__menu button { min-height: 36px; padding: 0 var(--sp-3); border: 0; border-radius: var(--r-sm); color: var(--ink); background: transparent; text-align: left; cursor: pointer; }
.zz-experts .personal-expert-card__menu button:hover, .zz-experts .personal-expert-card__menu button:focus-visible { outline: none; background: var(--sunken); }
.zz-experts .expert-badge { padding: var(--sp-1) var(--sp-2); border-radius: var(--r-pill); font-size: var(--fs-100); white-space: nowrap; }
.zz-experts .expert-badge[data-badge='usable'] { color: var(--accent-text); background: var(--accent-soft); }
.zz-experts .expert-badge[data-badge='uploaded'] { color: var(--ok-text, var(--accent-text)); background: var(--ok-soft, var(--sunken)); }
.zz-experts .expert-badge[data-badge='published'] { color: var(--accent-text); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line, var(--accent)); }
.zz-experts .expert-badge[data-badge='remote-only'] { color: var(--muted2); background: var(--sunken); box-shadow: inset 0 0 0 1px var(--line); }
.zz-experts .expert-badge[data-badge='local-only'] { color: var(--muted2); background: var(--sunken); }
.zz-experts .personal-expert-card__desc { color: var(--muted2); line-height: 1.5; }
.zz-experts .personal-expert-card__lineage { display: grid; gap: var(--sp-1); margin: 0; padding: var(--sp-2) var(--sp-3); border-radius: var(--r-sm); background: var(--sunken); font-size: var(--fs-100); }
.zz-experts .personal-expert-card__lineage div { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--sp-2); }
.zz-experts .personal-expert-card__lineage dt { color: var(--muted); }
.zz-experts .personal-expert-card__lineage dd { min-width: 0; margin: 0; overflow: hidden; color: var(--muted2); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .expert-detail__head { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-5); border-bottom: var(--bw) solid var(--line); }
.zz-experts .expert-detail__avatar { display: grid; width: 44px; height: 44px; place-items: center; border-radius: var(--r-pill); background: var(--accent-soft); color: var(--accent); }
.zz-experts .expert-detail__identity { flex: 1; min-width: 0; }
.zz-experts .expert-detail__identity h2 { margin: 0; font-size: var(--fs-600); }
.zz-experts .expert-detail__identity p { margin: 0; color: var(--muted2); font-size: var(--fs-meta); }
.zz-experts .expert-detail__close { border: 0; background: transparent; color: var(--muted2); cursor: pointer; font-size: var(--fs-600); }
.zz-experts .expert-detail__panel { box-sizing: border-box; width: min(430px, 92vw); height: calc(100vh - var(--topbar-h)); margin-top: var(--topbar-h); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; color: var(--ink); background: var(--panel); border-left: var(--bw) solid var(--line-strong); box-shadow: var(--sh-3); pointer-events: auto; }
.zz-experts .expert-detail__hint { margin: 0; color: var(--muted2); font-size: var(--fs-meta); }
.zz-experts .expert-detail__body { min-height: 0; display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-5); overflow-y: auto; overscroll-behavior: contain; }
.zz-experts .expert-detail__desc { margin: 0; }
.zz-experts .expert-detail__tags { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.zz-experts .expert-detail__tags span { padding: 2px var(--sp-2); border: var(--bw) solid var(--line); border-radius: var(--r-pill); color: var(--muted2); font-size: var(--fs-meta); }
.zz-experts .expert-detail__prompts h3 { margin: 0 0 var(--sp-2); font-size: var(--fs-body); }
.zz-experts .expert-detail__prompt-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.zz-experts .expert-detail__prompt { padding: var(--sp-2) var(--sp-3); border: var(--bw) solid var(--line); border-radius: var(--r-sm); background: var(--panel); color: var(--ink); cursor: pointer; text-align: left; transition: background var(--d-press) var(--spring-snappy), border-color var(--d-press) var(--spring-snappy); }
.zz-experts .expert-detail__prompt:hover { border-color: var(--accent-line); background: var(--accent-soft); }
.zz-experts .expert-detail__foot { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-4) var(--sp-5); border-top: var(--bw) solid var(--line); }
.zz-experts .expert-detail__foot-spacer { flex: 1; }
.zz-experts .expert-manage-modal { display: flex; width: min(620px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 40px)); flex-direction: column; overflow: hidden; border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-3); pointer-events: auto; }
.zz-experts .expert-manage-modal__body { display: grid; gap: var(--sp-4); overflow: auto; padding: var(--sp-5); }
.zz-experts .expert-manage-modal__description, .zz-experts .expert-manage-modal__notice, .zz-experts .expert-manage-modal__error { margin: 0; }
.zz-experts .expert-manage-modal__description { color: var(--muted2); line-height: var(--lh-body); }
.zz-experts .expert-manage-modal__metadata { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); margin: 0; }
.zz-experts .expert-manage-modal__metadata div { min-width: 0; padding: var(--sp-3); border-radius: var(--r-md); background: var(--sunken); }
.zz-experts .expert-manage-modal__metadata dt { color: var(--muted); font-size: var(--fs-100); }
.zz-experts .expert-manage-modal__metadata dd { margin: var(--sp-1) 0 0; overflow: hidden; color: var(--ink); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .expert-manage-modal__notice, .zz-experts .expert-manage-modal__error { padding: var(--sp-3); border-radius: var(--r-md); }
.zz-experts .expert-manage-modal__notice { color: var(--accent-text); background: var(--accent-soft); }
.zz-experts .expert-manage-modal__error { color: var(--danger-text); background: var(--danger-soft, #fff1f0); }
.zz-experts .expert-manage-modal__footer, .zz-experts .expert-manage-modal__secondary-actions { display: flex; align-items: center; gap: var(--sp-2); }
.zz-experts .expert-manage-modal__footer { justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-top: var(--bw) solid var(--line); }
.zz-experts .expert-manage-modal__secondary-actions { flex-wrap: wrap; }
@media (max-width: 620px) { .zz-experts .expert-manage-modal__metadata { grid-template-columns: 1fr; }
.zz-experts .expert-manage-modal__footer { align-items: stretch; flex-direction: column-reverse; }
}
.zz-experts .expert-versions { display: flex; width: min(560px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 40px)); flex-direction: column; overflow: hidden; border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--sh-3); pointer-events: auto; }
.zz-experts .expert-versions__body { display: grid; gap: var(--sp-4); overflow: auto; padding: var(--sp-5); }
.zz-experts .expert-versions__draft { margin: 0; padding: var(--sp-3); border-radius: var(--r-md); color: var(--accent-text); background: var(--accent-soft); font-size: var(--fs-200); }
.zz-experts .expert-versions__items { display: grid; gap: var(--sp-2); margin: 0; padding: 0; list-style: none; }
.zz-experts .expert-versions__item { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); border: var(--bw) solid var(--line); border-radius: var(--r-md); background: var(--panel); }
.zz-experts .expert-versions__item-main { min-width: 0; flex: 1; }
.zz-experts .expert-versions__item-label, .zz-experts .expert-versions__item-time { margin: 0; overflow: hidden; text-overflow: ellipsis; }
.zz-experts .expert-versions__item-label { display: flex; align-items: center; gap: var(--sp-2); color: var(--ink); font-weight: var(--fw-title); }
.zz-experts .expert-versions__current { padding: 0 var(--sp-2); border-radius: var(--r-pill); color: var(--accent-text); background: var(--accent-soft); font-size: var(--fs-100); font-weight: var(--fw-body, 400); }
.zz-experts .expert-versions__item-time { margin-top: var(--sp-1); color: var(--muted); font-size: var(--fs-100); }
.zz-experts .expert-versions__error { margin: 0; padding: var(--sp-3); border-radius: var(--r-md); }
.zz-experts .expert-versions__error { color: var(--danger-text); background: var(--danger-soft, #fff1f0); }
.zz-experts .featured { display: flex; flex-direction: column; gap: var(--sp-3); }
.zz-experts .featured__header { display: flex; align-items: center; gap: var(--sp-3); }
.zz-experts .featured__header h2 { margin: 0; font-size: var(--fs-600); font-weight: var(--fw-title); }
.zz-experts .featured__header p { margin: 0; color: var(--muted2); font-size: var(--fs-200); }
.zz-experts .featured__rail { display: grid; grid-auto-columns: 244px; grid-auto-flow: column; gap: var(--sp-3); overflow-x: auto; padding-bottom: var(--sp-2); scroll-snap-type: x proximity; }
.zz-experts .scene { position: relative; display: flex; min-height: 224px; flex-direction: column; align-items: flex-start; gap: var(--sp-2); overflow: hidden; padding: var(--sp-4); border: var(--bw) solid var(--line); border-radius: var(--r-lg); color: var(--ink); background: var(--panel); text-align: left; scroll-snap-align: start; cursor: pointer; }
.zz-experts .scene__icon, .zz-experts .scene__count { position: absolute; z-index: 1; }
.zz-experts .scene__icon { top: var(--sp-4); left: var(--sp-4); }
.zz-experts .scene__count { right: var(--sp-4); bottom: var(--sp-4); color: var(--muted2); font: var(--fs-100) / 1 var(--font-mono); }
.zz-experts .scene strong, .zz-experts .scene__description { position: relative; }
.zz-experts .scene strong { margin-bottom: var(--sp-2); font-size: var(--fs-500); }
.zz-experts .scene__description { display: flex; max-width: 100%; align-items: center; gap: var(--sp-2); overflow: hidden; color: var(--muted2); font-size: var(--fs-100); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .editor-page { display: flex; min-height: 100%; flex-direction: column; gap: var(--sp-5); padding: var(--sp-5) var(--sp-6) var(--sp-7); }
.zz-experts .version-line { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); border: var(--bw) solid var(--line); border-radius: var(--r-md); background: var(--panel); }
.zz-experts .version-line__label { color: var(--ink); font-size: var(--fs-200); }
.zz-experts .lineage-fold summary { color: var(--muted2); font-size: var(--fs-100); cursor: pointer; }
.zz-experts .lineage-fold__summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3); margin: var(--sp-3) 0 0; }
.zz-experts .lineage-fold__summary div { min-width: 0; padding: var(--sp-3); border-radius: var(--r-md); background: var(--sunken); }
.zz-experts .lineage-fold__summary dt { margin-bottom: var(--sp-1); color: var(--muted); font-size: var(--fs-100); }
.zz-experts .lineage-fold__summary dd { margin: 0; overflow: hidden; color: var(--ink); font-size: var(--fs-200); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .expert-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--sp-5); }
.zz-experts .expert-form section { display: flex; flex-direction: column; gap: var(--sp-4); padding: var(--sp-5); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.zz-experts .expert-form h2 { margin: 0; font-size: var(--fs-500); }
.zz-experts .expert-form label { display: flex; flex-direction: column; gap: var(--sp-2); color: var(--muted2); font-size: var(--fs-200); }
.zz-experts .expert-form input, .zz-experts .expert-form select, .zz-experts .expert-form textarea { width: 100%; box-sizing: border-box; padding: var(--sp-3); border: var(--bw) solid var(--line-strong); border-radius: var(--r-md); color: var(--ink); background: var(--bg); font: inherit; resize: vertical; }
.zz-experts .expert-form input, .zz-experts .expert-form select { height: var(--ctl-h-lg); }
.zz-experts .capability-provision { display: grid; gap: var(--sp-4); padding: var(--sp-5); border: var(--bw) solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.zz-experts .capability-provision__heading h2 { margin: 0; font-size: var(--fs-500); }
.zz-experts .capability-provision__heading p { margin: var(--sp-1) 0 0; color: var(--muted2); font-size: var(--fs-100); }
.zz-experts .capability-group { display: grid; gap: var(--sp-3); padding: var(--sp-4); border: var(--bw) solid var(--line); border-radius: var(--r-md); background: var(--sunken); }
.zz-experts .capability-group__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); }
.zz-experts .capability-group__head h3 { margin: 0; font-size: var(--fs-300); }
.zz-experts .capability-group__head span { color: var(--muted2); font-size: var(--fs-100); }
.zz-experts .capability-empty, .zz-experts .capability-hint { margin: 0; color: var(--muted2); font-size: var(--fs-100); }
.zz-experts .capability-list { display: grid; gap: var(--sp-2); margin: 0; padding: 0; list-style: none; }
.zz-experts .capability-item { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: var(--bw) solid var(--line); border-radius: var(--r-md); background: var(--panel); }
.zz-experts .capability-item__body { display: grid; min-width: 0; gap: var(--sp-1); }
.zz-experts .capability-item__body strong { overflow: hidden; color: var(--ink); text-overflow: ellipsis; white-space: nowrap; }
.zz-experts .capability-item__stale { color: var(--muted); font-size: var(--fs-100); }
.zz-experts .capability-item--stale { opacity: 0.6; }
.zz-experts .capability-add { display: flex; flex-direction: column; gap: var(--sp-2); color: var(--muted2); font-size: var(--fs-100); }
.zz-experts .capability-add select { width: 100%; box-sizing: border-box; height: var(--ctl-h-lg); padding: var(--sp-3); border: var(--bw) solid var(--line-strong); border-radius: var(--r-md); color: var(--ink); background: var(--bg); font: inherit; }
.zz-experts .editor-page__error { padding: var(--sp-3); border: var(--bw) solid var(--danger-line); border-radius: var(--r-md); color: var(--danger-text); background: var(--danger-soft); }
@media (max-width: 1000px) { .zz-experts .lineage-fold__summary { grid-template-columns: 1fr; }
.zz-experts .expert-form { grid-template-columns: 1fr; }
}
.zz-experts { position: relative; min-height: 100%; width: 100%; box-sizing: border-box; background: var(--bg); }
.zz-experts .experts-page__content { width: 100%; max-width: 1740px; box-sizing: border-box; margin-inline: auto; padding: var(--sp-5) var(--sp-6) var(--sp-7); }
.zz-experts .resource-page-nav { padding-inline: var(--sp-6); }
.zz-experts .resource-page-hero { grid-template-columns: minmax(0, 1fr) minmax(260px, 1fr); align-items: center; gap: var(--sp-6); }
.zz-experts .resource-page-hero h1 { font-size: var(--fs-700); }
.zz-experts .resource-page-hero__subtitle { margin-top: var(--sp-2); font-size: var(--fs-300); }
.zz-experts .experts-actions { display: flex; min-width: 0; margin-left: auto; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.zz-experts .experts-featured-scenes { margin-top: var(--sp-5); }
.zz-experts .featured { gap: 13px; }
.zz-experts .featured h2 { font-size: 15px; }
.zz-experts .featured__rail { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row; gap: 11px; overflow: visible; padding: 0; }
.zz-experts .scene { display: grid; grid-template-columns: var(--ctl-h-sm) minmax(0, 1fr); min-height: calc(var(--ctl-h) * 3); align-content: center; gap: var(--sp-2) var(--sp-3); padding: var(--sp-4); border: 0; border-radius: 12px; color: #f7f8f4; background: linear-gradient(180deg, transparent 12%, rgba(8, 10, 9, 0.86)), radial-gradient(circle at 72% 16%, rgba(94, 156, 255, 0.68), transparent 34%), linear-gradient(135deg, #263c5c, #171e29); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); opacity: 1 !important; transition: transform var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out); }
.zz-experts .scene::before { position: absolute; top: -10px; right: -12px; width: 88px; height: 88px; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 24px; content: ''; pointer-events: none; transform: rotate(24deg); }
.zz-experts .scene:nth-child(2n) { background: linear-gradient(180deg, transparent 12%, rgba(8, 10, 9, 0.86)), radial-gradient(circle at 72% 16%, rgba(178, 126, 255, 0.58), transparent 34%), linear-gradient(135deg, #3d3158, #211a2b); }
.zz-experts .scene:hover { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 12px 24px rgba(0, 0, 0, 0.16); transform: translateY(-2px); }
.zz-experts .scene.is-selected { box-shadow: inset 0 0 0 2px var(--accent), 0 12px 24px rgba(0, 0, 0, 0.2); }
.zz-experts .scene__icon { position: static; grid-row: 1 / span 2; align-self: center; color: rgba(247, 248, 244, 0.78); transition: color var(--dur-2) var(--ease-out), filter var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.zz-experts .scene.is-selected .scene__icon { color: #fff; filter: drop-shadow(0 0 8px rgba(86, 199, 216, 0.58)); transform: scale(1.08); }
.zz-experts .scene__count { right: 17px; bottom: 17px; color: rgba(247, 248, 244, 0.62); }
.zz-experts .scene strong { grid-column: 2; margin: 0 0 2px; font-size: var(--fs-500); }
.zz-experts .scene__description { grid-column: 2; padding-right: var(--sp-5); color: rgba(247, 248, 244, 0.68); }
:root[data-theme='light'] .zz-experts .scene { color: #173258; background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 10%, rgba(232, 242, 255, 0.76)), radial-gradient(circle at 72% 14%, rgba(79, 145, 236, 0.36), transparent 36%), linear-gradient(135deg, #f7fbff, #dcecff); box-shadow: inset 0 0 0 1px rgba(53, 103, 171, 0.14), 0 8px 22px rgba(49, 93, 153, 0.08); }
:root[data-theme='light'] .zz-experts .scene:nth-child(2n) { background: linear-gradient(180deg, rgba(255, 255, 255, 0.1) 10%, rgba(241, 235, 255, 0.78)), radial-gradient(circle at 72% 14%, rgba(145, 104, 224, 0.28), transparent 36%), linear-gradient(135deg, #fbf9ff, #e9e1fa); }
:root[data-theme='light'] .zz-experts .scene::before { border-color: rgba(53, 91, 148, 0.16); }
:root[data-theme='light'] .zz-experts .scene:hover, :root[data-theme='light'] .zz-experts .scene.is-selected { color: #10284b; background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 8%, rgba(222, 237, 255, 0.88)), radial-gradient(circle at 72% 14%, rgba(65, 136, 232, 0.44), transparent 36%), linear-gradient(135deg, #f4f9ff, #d5e8ff); box-shadow: inset 0 0 0 2px var(--accent), 0 12px 26px rgba(49, 93, 153, 0.14); }
:root[data-theme='light'] .zz-experts .scene:nth-child(2n):hover, :root[data-theme='light'] .zz-experts .scene:nth-child(2n).is-selected { background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 8%, rgba(237, 227, 255, 0.9)), radial-gradient(circle at 72% 14%, rgba(137, 91, 219, 0.4), transparent 36%), linear-gradient(135deg, #faf7ff, #e5daf8); }
:root[data-theme='light'] .zz-experts .scene__icon, :root[data-theme='light'] .zz-experts .scene strong { color: #173258; }
:root[data-theme='light'] .zz-experts .scene.is-selected .scene__icon { color: #fff; }
:root[data-theme='light'] .zz-experts .scene__description, :root[data-theme='light'] .zz-experts .scene__count { color: #526b8e; }
.zz-experts .experts-installed { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3) var(--sp-5); margin-top: var(--sp-5); padding-bottom: var(--sp-5); border-bottom: var(--bw) solid var(--line); }
.zz-experts .experts-installed__header { display: flex; align-items: center; gap: 10px; }
.zz-experts .experts-installed__header h2 { margin: 0; font-size: 15px; }
.zz-experts .experts-installed__header span { color: var(--muted); font: var(--fs-100) / 1 var(--font-mono); }
.zz-experts .experts-installed__rail { display: flex; flex-wrap: wrap; min-width: 0; gap: 10px; margin-top: 0; }
.zz-experts .experts-installed__rail button { display: grid; width: 42px; min-width: 42px; height: 42px; padding: 0; border: 0; border-radius: 11px; color: var(--muted2); background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); place-items: center; cursor: pointer; transition: transform var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out); }
.zz-experts .experts-installed__rail button:hover { color: var(--ink); background: var(--raised); transform: translateY(-2px); }
.zz-experts .experts-installed__rail .experts-installed__empty { width: auto; padding-inline: 12px; font-size: var(--fs-200); }
.zz-experts .experts-directory-tabs { display: flex; align-items: center; gap: 8px; margin: 28px 0 0; }
.zz-experts .experts-directory-tabs button { min-height: 32px; padding: 4px 12px; border: 0; border-radius: 8px; color: var(--muted2); background: transparent; font-size: 14px; cursor: pointer; }
.zz-experts .experts-directory-tabs button[aria-selected=true] { color: var(--ink); background: var(--raised); font-weight: 650; }
.zz-experts .experts-directory-tabs button:disabled { cursor: default; opacity: .5; }
.zz-experts .experts-directory-tabs + .zz-directory-section { margin-top: 16px; }
.zz-experts .my-experts-trigger { display: inline-flex; height: var(--ctl-h); align-items: center; gap: var(--sp-2); padding: 0 var(--sp-3); border: 0; border-radius: var(--r-md); color: var(--ink); background: var(--panel); box-shadow: var(--sh-1); font-weight: var(--fw-label); cursor: pointer; }
.zz-experts .my-experts-trigger__count { display: grid; min-width: 18px; height: 18px; place-items: center; border-radius: var(--r-pill); color: var(--accent-text); background: var(--accent-soft); font-size: var(--fs-100); }
.zz-experts .expert-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 10px; }
.zz-experts .expert-card, .zz-experts .personal-expert-card { min-height: 118px; padding: 16px; border-radius: 11px; background: color-mix(in srgb, var(--panel) 78%, transparent); box-shadow: none; transition: transform var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out), background var(--dur-2) var(--ease-out); }
.zz-experts .expert-card:hover, .zz-experts .personal-expert-card:hover { border-color: var(--line-strong); background: var(--panel); transform: translateY(-1px); }
.zz-experts .directory-state { display: grid; min-height: 240px; place-content: center; justify-items: center; gap: var(--sp-3); color: var(--muted2); text-align: center; }
.zz-experts .directory-state--slim { min-height: 104px; }
.zz-experts .directory-state--error strong { color: var(--danger-text); }
@media (max-width: 760px) { .zz-experts .experts-page__content { padding: var(--sp-4) var(--sp-3) var(--sp-6); }
.zz-experts .resource-page-nav { height: auto; min-height: var(--ctl-h-lg); flex-wrap: wrap; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); }
.zz-experts .resource-page-hero { grid-template-columns: 1fr; gap: var(--sp-3); }
.zz-experts .experts-actions { flex-wrap: nowrap; }
.zz-experts .expert-grid { grid-template-columns: 1fr; }
.zz-experts .featured__rail { grid-template-columns: 1fr; }
}
.zz-experts .zz-expert-modal {width:min(560px,92vw)}
.zz-experts .zz-expert-dialog-body {padding:20px;display:grid;gap:16px}
.zz-experts .zz-expert-dialog-footer {display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--line)}
.zz-experts .zz-expert-field {display:grid;gap:6px;color:var(--muted2);font-size:12px}
.zz-experts .zz-expert-field :is(input,select) {width:100%;height:40px;padding:8px 12px;border:1px solid var(--line-strong);border-radius:6px;color:var(--ink);background:var(--bg)}
.zz-experts .zz-expert-stack {display:grid;gap:12px;margin-top:12px}
.zz-experts .zz-expert-actions {display:flex;flex-wrap:wrap;gap:8px}
.zz-experts .zz-expert-cloud {border-top:1px solid var(--line);padding-top:16px}
.zz-experts .expert-detail__panel {position:fixed;inset:0 0 0 auto;width:min(430px,92vw);height:100dvh;max-height:100dvh;margin:0;border-radius:0;display:flex;flex-direction:column}
.zz-experts .expert-detail__body {flex:1}
.zz-experts .expert-manage-modal {width:min(680px,94vw)}
.zz-experts .expert-manage-modal__body {overflow:auto}
.zz-experts .zz-expert-editor-header {display:flex;justify-content:space-between;align-items:center;gap:24px}
.zz-experts .zz-expert-editor-header h1 {font-size:var(--fs-500);margin:0 0 3px}
.zz-experts .zz-expert-editor-heading {display:flex;align-items:flex-start;gap:var(--sp-3)}
.zz-experts .zz-expert-editor-header p {margin:4px 0 0;color:var(--muted2)}
.zz-experts .zz-expert-field-row {display:grid;grid-template-columns:1fr 1fr;gap:12px}
.zz-experts .capability-provision {margin-top:20px}
.zz-experts .zz-my-expert-list {display:grid;gap:8px;margin-top:16px}
.zz-experts .zz-my-expert-list article {display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:8px;padding:12px}
.zz-experts .zz-my-expert-list article > div {flex:1;min-width:0}
.zz-experts .zz-my-expert-list p {margin:0;color:var(--muted2);font-size:12px}
.zz-experts .zz-expert-import {display:grid;justify-items:center;gap:20px;padding:32px;border:1px dashed var(--line-strong);border-radius:12px;background:var(--sunken)}
.zz-experts .zz-expert-menu {width:min(340px,90vw)}
.zz-experts .zz-expert-menu .personal-expert-card__menu {position:static;display:grid;width:100%;border:0;box-shadow:none;padding:12px}
.zz-experts pre {padding:14px;background:var(--sunken);white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 var(--font-mono);border-radius:8px}
@media(max-width:700px){.zz-experts .resource-page-nav {height:auto;min-height:54px;flex-wrap:wrap;padding:10px}.zz-experts .zz-expert-editor-header {align-items:flex-start}.zz-experts .editor-page {padding:14px 0}}
@media(prefers-reduced-motion:reduce){.zz-experts .expert-card,.zz-experts .personal-expert-card {animation:none;transition:none}}
`
