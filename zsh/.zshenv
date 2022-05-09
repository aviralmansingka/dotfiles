###############################
#         Utilities           #
###############################

function google-java-format() {
  java -jar $HOME/.cache/google-java-format/google-java-format-1.15.0-all-deps.jar $@
}

function notify() {
    terminal-notifier -title "iTerm2" -message $1
}


###############################
#        Kubernetes           #
###############################

alias kg="kubectl get"
