Capture notes — modal-machine-manager round 01

Each <view>.commands.txt holds the exact commands, the returned pane id, and the
timestamps for that view. <view>.dimensions.txt is the `stty size` output written
from inside the viewer pane (`47 77` for all four views).

<view>.header.json is the raw `herdr pane wait-output --match rataflow-view`
response. It records `{"error":"timeout"}` because the colour escapes split the
banner text for the matcher; the viewer did start. The header was therefore
verified from line 1 of the visible capture and stored as
checks/<view>.header.txt (`header_ok=yes`).

<view>.unselected.* is the render with no node selected; <view>.selected.* is the
same pane after one Tab press (the selected box border and all four corners turn
bold accent). No pan, zoom, or `f` was used at any point.
