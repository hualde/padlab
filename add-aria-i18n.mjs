import { readFileSync, writeFileSync } from 'node:fs';
let html = readFileSync('index.html','utf8');
const replacements = [
  ['<nav class="tabs" role="tablist" aria-label="Secciones">', '<nav class="tabs" role="tablist" aria-label="Secciones" data-i18n-aria-label="aria.sections">'],
  ['<a class="brand" href="#" aria-label="PadLab, inicio">', '<a class="brand" href="#" aria-label="PadLab, inicio" data-i18n-aria-label="aria.home">'],
  ['<section class="stage panel" aria-label="Mesa de práctica">', '<section class="stage panel" aria-label="Mesa de práctica" data-i18n-aria-label="aria.practice">'],
  ['<div class="mini" aria-label="Resumen de la toma">', '<div class="mini" aria-label="Resumen de la toma" data-i18n-aria-label="aria.takeSummary">'],
  ['<div class="segmented mode-switch" id="mode-control" role="group" aria-label="Modo de práctica">', '<div class="segmented mode-switch" id="mode-control" role="group" aria-label="Modo de práctica" data-i18n-aria-label="aria.mode">'],
  ['<div class="segmented" id="density-control" role="group" aria-label="Densidad de notas">', '<div class="segmented" id="density-control" role="group" aria-label="Densidad de notas" data-i18n-aria-label="aria.density">'],
  ['<button class="step-btn" id="bpm-minus" aria-label="Bajar 5 BPM">', '<button class="step-btn" id="bpm-minus" aria-label="Bajar 5 BPM" data-i18n-aria-label="aria.bpmDown">'],
  ['<button class="step-btn" id="bpm-plus" aria-label="Subir 5 BPM">', '<button class="step-btn" id="bpm-plus" aria-label="Subir 5 BPM" data-i18n-aria-label="aria.bpmUp">'],
  ['<input class="range" type="range" id="bpm-range" min="40" max="240" step="1" value="100" aria-label="Tempo en BPM">', '<input class="range" type="range" id="bpm-range" min="40" max="240" step="1" value="100" aria-label="Tempo en BPM" data-i18n-aria-label="aria.tempo">'],
  ['<button class="modal-x" id="modal-x" aria-label="Cerrar">', '<button class="modal-x" id="modal-x" aria-label="Cerrar" data-i18n-aria-label="aria.close">'],
  ['<div class="mobile-dock" id="mobile-dock" aria-label="Transporte rápido">', '<div class="mobile-dock" id="mobile-dock" aria-label="Transporte rápido" data-i18n-aria-label="aria.dock">'],
  ['<div class="segmented" id="language-control" role="group" aria-label="Idioma">', '<div class="segmented" id="language-control" role="group" aria-label="Idioma" data-i18n-aria-label="aria.language">'],
  ['<canvas id="stroke-canvas" aria-label="Línea temporal de golpes: marca la mano derecha o izquierda y el momento de tocar">', '<canvas id="stroke-canvas" aria-label="Línea temporal de golpes: marca la mano derecha o izquierda y el momento de tocar" data-i18n-aria-label="aria.strokeLane">'],
  ['<button class="dock-step" id="dock-minus" aria-label="Bajar 5 BPM">', '<button class="dock-step" id="dock-minus" aria-label="Bajar 5 BPM" data-i18n-aria-label="aria.bpmDown">'],
  ['<button class="dock-step" id="dock-plus" aria-label="Subir 5 BPM">', '<button class="dock-step" id="dock-plus" aria-label="Subir 5 BPM" data-i18n-aria-label="aria.bpmUp">'],
];
for (const [a,b] of replacements) {
  if (!html.includes(a)) console.log('NOT FOUND:', a.slice(0,60));
  html = html.replace(a,b);
}
writeFileSync('index.html', html);
