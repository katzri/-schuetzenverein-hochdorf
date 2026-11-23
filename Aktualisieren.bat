@echo off
title Schuetzenverein Hochdorf - Aktualisieren
rem Holt die neueste Version des Programms und startet den Server auf Wunsch neu. Die Daten bleiben unberuehrt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\aktualisieren.ps1" %*
