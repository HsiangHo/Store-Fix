//
//  ViewController.swift
//  Shared (App)
//
//  Created by Jovi on 6/8/26.
//

import WebKit

#if os(iOS)
import UIKit
import SafariServices
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

let extensionBundleIdentifier = "com.HyperartFlow.Store-Fix.Extension"

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!
#if os(iOS)
    private var hasLoadedActivationPage = false
#endif

#if os(iOS)
    override func loadView() {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        self.webView = webView
        self.view = webView
    }
#endif

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

#if os(iOS)
        self.webView.scrollView.isScrollEnabled = false
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
#endif

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

#if os(iOS)
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
#endif

#if os(iOS)
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        showIOSActivationState()
    }

    @objc private func applicationDidBecomeActive() {
        showIOSActivationState()
    }
#endif

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(iOS)
        hasLoadedActivationPage = true
        showIOSActivationState()
#elseif os(macOS)
        webView.evaluateJavaScript("show('mac')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), false)")
                }
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(iOS)
        guard message.body as? String == "open-extension-settings" else {
            return
        }

        if #available(iOS 26.2, *) {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { error in
                guard let error = error else {
                    self.showIOSActivationState()
                    return
                }

                self.showIOSActivationState { isEnabled in
                    guard isEnabled != true else {
                        return
                    }

                    self.presentSettingsError(error)
                }
            }
        } else {
            presentManualSettingsInstructions()
        }
#elseif os(macOS)
        guard message.body as? String == "open-preferences" else {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                NSApp.terminate(self)
            }
        }
#endif
    }

#if os(iOS)
    private func showIOSActivationState(completion: ((Bool?) -> Void)? = nil) {
        guard hasLoadedActivationPage else {
            completion?(nil)
            return
        }

        webView.evaluateJavaScript("show('ios', null, false)")

        if #available(iOS 26.2, *) {
            SFSafariExtensionManager.getStateOfExtension(withIdentifier: extensionBundleIdentifier) { state, error in
                DispatchQueue.main.async {
                    guard let state = state, error == nil else {
                        self.webView.evaluateJavaScript("show('ios', null, false)")
                        completion?(nil)
                        return
                    }

                    self.webView.evaluateJavaScript("show('ios', \(state.isEnabled), true)")
                    completion?(state.isEnabled)
                }
            }
        } else {
            completion?(nil)
        }
    }

    private func presentManualSettingsInstructions() {
        DispatchQueue.main.async {
            let alert = UIAlertController(
                title: "Open Safari Settings",
                message: "Open Settings > Apps > Safari > Extensions, then turn on Store Fix.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            self.present(alert, animated: true)
        }
    }

    private func presentSettingsError(_ error: Error) {
        DispatchQueue.main.async {
            let message: String
            let nsError = error as NSError

            if nsError.domain == SFErrorDomain && nsError.code == 6 {
                message = "iOS temporarily blocked opening this settings page after repeated attempts. Open Settings > Apps > Safari > Extensions, then turn on Store Fix."
            } else {
                message = "\(error.localizedDescription)\n\nOpen Settings > Apps > Safari > Extensions, then turn on Store Fix."
            }

            let alert = UIAlertController(
                title: "Could Not Open Settings",
                message: message,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            self.present(alert, animated: true)
        }
    }
#endif
}
