function build-tags-py() {
    find . -name "*.py" -print | xargs etags --append
}

function build-tags-js() {
    find . -name "*.js" -print | xargs etags --append
}

function build-tags-cpp() {
    find . -name "*.cpp" -print -or -name "*.h" -print | xargs etags --append
}

function mc() {
    ssh amansin@mc18.cs.purdue.edu
}
function data() {
    ssh amansin@data.cs.purdue.edu
}

function xinu() {
    ssh amansin@xinu02.cs.purdue.edu
}

function zaphod() {
    ssh amansin@zaphod.cs.purdue.edu
}
