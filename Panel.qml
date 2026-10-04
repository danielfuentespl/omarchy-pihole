import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "ServiceHost.js" as ServiceHost

Panel {
    id: root

    moduleName: "com.blogvirtualizado.omaops.pihole"
    ipcTarget: "com.blogvirtualizado.omaops.pihole"
    manageIpc: false

    property double nowMs: Date.now()

    QtObject {
        id: dummyService
        property var settings: ({})
        property bool refreshing: false
        property bool configured: false
        property bool authenticated: false
        property bool blockingEnabled: false
        property bool stale: false
        property bool hasData: false
        property string health: "unknown"
        property string stateSymbol: "?"
        property string stateLabel: "UNKNOWN"
        property string lastError: ""
        property date lastUpdated: new Date(0)
        property int queriesTotal: 0
        property int queriesBlocked: 0
        property real percentBlocked: 0
        property int clientsActive: 0
        property int clientsTotal: 0
        property int domainsBlocked: 0
        property string webUrl: ""
        function refresh() {}
        function refreshIfStale() {}
    }

    readonly property var hostedService: {
        return ServiceHost.hostedService(bar)
    }
    readonly property var service: hostedService !== null ? hostedService : dummyService

    readonly property color foreground: bar ? bar.foreground : Color.foreground
    readonly property color urgent: bar ? bar.urgent : Color.urgent
    readonly property color statusColor: {
        if (service.health === "auth" || service.health === "config" || service.health === "critical" || service.health === "offline") return urgent
        if (service.health === "warning" || service.health === "stale") return Color.accent
        return foreground
    }
    readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    onOpenedChanged: if (opened) {
        nowMs = Date.now()
        service.refreshIfStale()
        Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    }

    Binding {
        target: root.hostedService
        property: "settings"
        value: root.settings
        when: root.hostedService !== null
    }

    Timer {
        interval: 10000
        repeat: true
        running: root.opened
        onTriggered: root.nowMs = Date.now()
    }


    BarIconButton {
        id: button
        anchors.fill: parent
        bar: root.bar

        iconComponent: Component {
            Item {
                Image {
                    id: piholeIcon
                    anchors.centerIn: parent
                    width: Style.space(14)
                    height: Style.space(14)
                    source: Qt.resolvedUrl("assets/pihole.svg")
                    fillMode: Image.PreserveAspectFit
                    smooth: true
                    mipmap: true
                }

                Rectangle {
                    width: Style.space(3)
                    height: width
                    radius: width / 2
                    color: root.statusColor
                    border.width: 1
                    border.color: root.background

                    anchors.right: piholeIcon.right
                    anchors.bottom: piholeIcon.bottom
                    anchors.rightMargin: -Style.space(1)
                    anchors.bottomMargin: -Style.space(1)
                }
            }
        }

        tooltipText: {
            if (service.refreshing) return "Pi-hole: refreshing"
            if (service.lastError) return "Pi-hole: " + service.stateLabel + " · " + service.lastError
            return "Pi-hole: " + service.stateLabel
        }

        onPressed: function(buttonCode) {
            if (buttonCode === Qt.LeftButton) root.toggle()
        }
    }

    KeyboardPanel {
        id: panel
        anchorItem: button
        owner: root
        bar: root.bar
        open: root.opened
        focusTarget: keyCatcher
        contentWidth: panel.fittedContentWidth(Style.space(360))
        contentHeight: panel.fittedContentHeight(content.implicitHeight + Style.space(16), Style.space(520))

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            onCloseRequested: root.close()
            onTextKey: function(text) {
                if (text === "r" || text === "R") service.refresh()
            }
        }

        ColumnLayout {
            id: content
            anchors.fill: parent
            anchors.margins: Style.space(16)
            spacing: Style.space(10)

            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(8)

                Text {
                    text: "Pi-hole"
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.space(15)
                    font.bold: true
                }

                Item { Layout.fillWidth: true }

                Text {
                    text: service.stateSymbol + " " + service.stateLabel
                    color: root.statusColor
                    font.family: root.fontFamily
                    font.pixelSize: Style.space(10)
                    font.bold: true
                }
            }

            Rectangle {
                Layout.fillWidth: true
                height: 1
                color: Color.muted
                opacity: 0.45
            }

            GridLayout {
                columns: 2
                columnSpacing: Style.space(18)
                rowSpacing: Style.space(7)
                Layout.fillWidth: true

                Text { text: "Queries"; color: Color.muted; font.family: root.fontFamily }
                Text { text: service.hasData ? Model.formatNumber(service.queriesTotal) : "—"; color: root.foreground; font.family: root.fontFamily; Layout.alignment: Qt.AlignRight }

                Text { text: "Blocked"; color: Color.muted; font.family: root.fontFamily }
                Text { text: service.hasData ? Model.formatNumber(service.queriesBlocked) : "—"; color: root.foreground; font.family: root.fontFamily; Layout.alignment: Qt.AlignRight }

                Text { text: "Blocked %"; color: Color.muted; font.family: root.fontFamily }
                Text { text: service.hasData ? Model.formatPercent(service.percentBlocked) : "—"; color: root.foreground; font.family: root.fontFamily; Layout.alignment: Qt.AlignRight }

                Text { text: "Active clients"; color: Color.muted; font.family: root.fontFamily }
                Text { text: service.hasData ? Model.formatNumber(service.clientsActive) : "—"; color: root.foreground; font.family: root.fontFamily; Layout.alignment: Qt.AlignRight }

                Text { text: "Domains blocked"; color: Color.muted; font.family: root.fontFamily }
                Text { text: service.hasData ? Model.formatNumber(service.domainsBlocked) : "—"; color: root.foreground; font.family: root.fontFamily; Layout.alignment: Qt.AlignRight }

                Text { text: "Blocking"; color: Color.muted; font.family: root.fontFamily }
                Text {
                    text: !service.hasData ? "UNKNOWN" : (service.blockingEnabled ? "ENABLED" : "DISABLED")
                    color: service.blockingEnabled ? root.foreground : root.urgent
                    font.family: root.fontFamily
                    font.bold: true
                    Layout.alignment: Qt.AlignRight
                }
            }

            Rectangle {
                Layout.fillWidth: true
                height: 1
                color: Color.muted
                opacity: 0.45
            }

            Text {
                Layout.fillWidth: true
                visible: service.lastError !== ""
                text: service.lastError
                textFormat: Text.PlainText
                color: service.health === "warning" ? Color.accent : root.urgent
                font.family: root.fontFamily
                font.pixelSize: Style.space(9)
                wrapMode: Text.Wrap
            }

            Text {
                Layout.fillWidth: true
                text: (service.hasData && service.stale ? "Previous data · Last update: " : "Last update: ") + Model.ageLabel(service.lastUpdated, root.nowMs)
                textFormat: Text.PlainText
                color: Color.muted
                font.family: root.fontFamily
                font.pixelSize: Style.space(9)
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(8)

                Rectangle {
                    implicitWidth: refreshLabel.implicitWidth + Style.space(18)
                    implicitHeight: refreshLabel.implicitHeight + Style.space(10)
                    radius: Style.space(4)
                    color: refreshTap.pressed ? root.foreground : "transparent"
                    border.width: 1
                    border.color: root.foreground
                    opacity: service.refreshing ? 0.45 : 1.0

                    Text {
                        id: refreshLabel
                        anchors.centerIn: parent
                        text: service.refreshing ? "Refreshing…" : "Refresh"
                        color: refreshTap.pressed ? root.background : root.foreground
                        font.family: root.fontFamily
                    }

                    TapHandler {
                        id: refreshTap
                        enabled: !service.refreshing
                        onTapped: service.refresh()
                    }
                }

                Item { Layout.fillWidth: true }

                Rectangle {
                    visible: service.webUrl !== ""
                    implicitWidth: webLabel.implicitWidth + Style.space(18)
                    implicitHeight: webLabel.implicitHeight + Style.space(10)
                    radius: Style.space(4)
                    color: webTap.pressed ? root.foreground : "transparent"
                    border.width: 1
                    border.color: root.foreground

                    Text {
                        id: webLabel
                        anchors.centerIn: parent
                        text: "Open Pi-hole"
                        color: webTap.pressed ? root.background : root.foreground
                        font.family: root.fontFamily
                    }

                    TapHandler {
                        id: webTap
                        onTapped: Qt.openUrlExternally(service.webUrl)
                    }
                }
            }
        }
    }
}
