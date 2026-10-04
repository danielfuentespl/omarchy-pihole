function hostedService(bar) {
    var shell = bar ? bar.shell : null
    if (!shell || typeof shell.serviceFor !== "function") return null
    return shell.serviceFor("com.blogvirtualizado.omaops.pihole") || null
}

if (typeof module !== "undefined") {
    module.exports = { hostedService: hostedService }
}
