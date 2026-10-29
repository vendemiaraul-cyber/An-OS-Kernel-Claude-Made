rem *** DOOM for MikeOS ***
rem MikeOS is a 16-bit OS and far too small to run DOOM itself, so this
rem program asks ConMon Lab (the web page this PC runs in) to open DOOM
rem in a window. It sends ESC ] CM;window.doom BEL out of serial port COM1
rem (I/O port 1016 = 3F8h). The page listens for it.

cls
print "  ____   ___   ___  __  __"
print " |  _ \ / _ \ / _ \|  \/  |"
print " | | | | | | | | | | |\/| |"
print " | |_| | |_| | |_| | |  | |"
print " |____/ \___/ \___/|_|  |_|   for MikeOS"
print ""
print "MikeOS can't run DOOM by itself (it's a 16-bit OS),"
print "so ConMon Lab opens DOOM in a window over this screen."
print "Arrows move, Ctrl fires, Space opens doors."
print "Close the window (or press F12) to come back here."
print ""
print "Press any key to start DOOM, or Esc to cancel."
waitkey x
if x = 27 then goto cancel

port out 1016 27
port out 1016 93
port out 1016 67
port out 1016 77
port out 1016 59
port out 1016 119
port out 1016 105
port out 1016 110
port out 1016 100
port out 1016 111
port out 1016 119
port out 1016 46
port out 1016 100
port out 1016 111
port out 1016 111
port out 1016 109
port out 1016 7

print ""
print "Opening DOOM..."
print "If nothing happens, this MikeOS isn't running inside ConMon Lab."
print ""
print "Press any key to go back to MikeOS."
waitkey x
cls
end

cancel:
cls
end
