@echo off
title Schuetzenverein Hochdorf - Einrichtung
rem Richtet das Bestellsystem auf diesem Rechner ein (Node.js, Daten, Verknuepfung, Autostart) und startet es.
rem Darf jederzeit erneut gestartet werden - vorhandene Daten bleiben unveraendert.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\einrichten.ps1" %*
