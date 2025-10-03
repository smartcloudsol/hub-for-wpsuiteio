=== Hub for WPSuite.io ===
Contributors: smartcloud
Tags: license, site connection, diagnostics
Requires at least: 6.7
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 1.0.0
License: MIT
License URI: https://mit-license.org/
Text Domain: hub-for-wpsuiteio

Central hub for all WP Suite plugins. Handles site connection, licence management, and provides a shared admin menu.

== Description ==

Hub for WPSuite.io is the common plugin that connects your WordPress site to the WP Suite service and manages your subscription licence.

It also provides a shared "WPSuite.io" menu in the WordPress admin, where all WP Suite extensions (like Gatey, AI Kit, etc.) register their settings and diagnostics.

Key features:
- Connect your WordPress site to your WP Suite account
- Manage and activate licences for premium features
- Centralised admin menu and settings shared across all WP Suite plugins

Documentation: [WP Suite – Docs](https://wpsuite.io/docs/)

== Installation ==

1. Upload the plugin files to `/wp-content/plugins/hub-for-wpsuiteio` or install directly from the WordPress plugin directory.
2. Activate the plugin through the "Plugins" screen.
3. Go to **WP Admin › WPSuite.io › Connect your Site** to link your site and manage your licence.

== Frequently Asked Questions ==

= Do I need Hub for WPSuite.io to use other WP Suite plugins? =
Free features in other plugins work without the Hub. Premium features require this plugin to connect your site and validate your licence.

= What data does the Hub store? =
The plugin stores a minimal configuration in your WordPress database (WPSuite.io accountId, site ID, licence key, feature flags). No sensitive customer data is stored locally.

= Is my site data shared with third parties? =
No. The Hub only communicates with the official WP Suite service (https://api.wpsuite.io) to register your site and manage your subscription.

== Screenshots ==

1. Central WPSuite.io menu showing active extensions
2. Admin screen to connect your site
3. Diagnostics page

== External Services ==

This plugin integrates with the following third-party services:

1. **Amazon Cognito**  
   - **What it is & what it’s used for:**  
     A managed user-identity and authentication service from Amazon Web Services (AWS). We use Cognito User Pools to handle user registration, login, multi-factor authentication (MFA), password resets, and JWT issuance.  
   - **What data is sent & when:**  
     - **Registration / Sign-up:** username, email, and any required attributes are sent to Cognito for account creation.  
     - **Sign-in / Authentication:** username and password (and MFA code if enabled) are sent to Cognito for verification.  
     - **Token exchange:** on successful login, Cognito returns ID, access, and refresh tokens which are stored client-side for session management.  
     - **Password reset & profile updates:** relevant identifiers and new credentials or attributes are sent when users trigger those flows.  
   - **Endpoints called:**  
     - `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`  
     - Other AWS API endpoints under the `amazonaws.com` domain.  
   - **Links:**  
     - Terms of Service: https://aws.amazon.com/service-terms/  
     - Privacy Policy: https://aws.amazon.com/privacy/

== Client-Side Libraries ==

1. **AWS Amplify Authenticator**  
   - **What it is & why we use it:**  
     A React UI component library from the Amplify Framework. We embed its `<Authenticator>` component inside our 'Connect your Site' admin page to render and manage the login/signup flows.  
   - **What it does:**  
     - Renders sign-in, sign-up, MFA, and password-reset forms.  
     - Under the hood it calls the Amazon Cognito APIs (see External Services entry), but **does not** itself authenticate or store secrets.  
   - **Docs & source:**  
     - GitHub repo: https://github.com/aws-amplify/amplify-ui  
     - Docs: https://ui.docs.amplify.aws/react/connected-components/authenticator
     
== Trademark Notice ==

Amazon Web Services, AWS, and Amazon Cognito are trademarks of Amazon.com, Inc. or its affiliates.  

Hub for is an independent open-source project and is **not affiliated with, sponsored by, or endorsed by Amazon Web Services**.

All references to “Amazon Cognito” are made purely to describe this plugin’s interoperability.

== Source & Build ==

**Public (free) source code:**  
All of the code that ships in this public ZIP (the “free” version) is published here: https://github.com/smartcloudsol/hub-for-wpsuiteio

== Changelog ==

= 1.0.0 =
* Initial release — site connection, diagnostics, shared admin menu.
