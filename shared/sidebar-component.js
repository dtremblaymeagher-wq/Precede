// Centralized Sidebar Component
class SidebarComponent {
    constructor() {
        this.currentPath = window.location.pathname;
        this.isExecutive = false;
        this.init();
    }

    async init() {
        await this.checkExecutiveMode();
        this.renderSidebar();
        this.setupMobileHandlers();
    }

    async checkExecutiveMode() {
        try {
            const activeId = localStorage.getItem('precede_active_instance_id');
            // Use Auth.fetch so the request carries the correct Clerk token
            const res = await Auth.fetch('/api/instances');
            if (!res.ok) return;
            const instances = await res.json();
            const active = instances.find(i => i.id === activeId);
            this.isExecutive = active?.instance_type === 'executive';
        } catch (err) {
            // non-fatal — sidebar renders in standard mode as fallback
        }
    }

    renderSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        const navItems = this.getNavItems();
        const dynamicContent = this.getDynamicContent();
        const solutionToggle = this.getSolutionModeToggle();

        sidebar.innerHTML = `
            <img src="/public/asset/logo.png" alt="" style="width: 100%; height: auto; margin-bottom: 16px; display: block;">
            <ul>
                ${navItems.map(item => this.createNavItem(item)).join('')}
            </ul>
            ${solutionToggle}
            ${dynamicContent}
        `;

        if (this.isExecutive) {
            sidebar.style.background = 'var(--color-bg-sidebar)';
        }

        // Notify listeners that the sidebar DOM is ready
        window.dispatchEvent(new CustomEvent('sidebarReady'));

        // Setup solution mode toggle event listener
        this.setupSolutionModeToggle();
        
        // Setup category expand/collapse functionality
        this.setupCategoryToggle();
    }

    getNavItems() {
        const standardCategories = [
            { href: '/dashboard.html', label: 'Home' },
            {
                label: 'Intelligence Hub',
                items: [
                    { href: '/Modules/intelligence-hub/data-entry.html', label: 'Capture Feedback' },
                    { href: '/Modules/intelligence-hub/data-archive.html', label: 'Data Archive' }
                ]
            },
            {
                label: 'Collaboration',
                items: [
                    { href: '/Modules/decision-log/decision-log.html', label: 'Decision Log' },
                    { href: '/Modules/solution-brainstorm/solution-brainstorm.html', label: 'Solution Brainstorming' },
                    { href: '/Modules/meeting-strategist/meeting-center.html', label: 'Meeting' }
                ]
            },
            {
                label: 'Product Delivery',
                items: [
                    { href: '/Modules/story-grooming/story-grooming.html', label: 'Story Grooming' },
                    { href: '/roadmap.html', label: 'Roadmap' }
                ]
            },
            {
                label: 'Ground Truth',
                items: [
                    { href: '/Modules/Backlog/backlog-view.html', label: 'Backlog' },
                    { href: '/epic-lifecycle.html', label: 'Epic Lifecycle' },
                    { href: '/Modules/settings/settings.html', label: 'Settings' }
                ]
            },
            {
                label: 'A/B Testing',
                items: [
                    { href: '/dashboard-v2.html', label: 'Dashboard v2' },
                    { href: '/dashboard-v3.html', label: 'Dashboard v3' }
                ]
            }
        ];

        const executiveCategories = [
            { href: '/dashboard-exec.html', label: 'Executive View' },
            {
                label: 'Intelligence Hub',
                items: [
                    { href: '/Modules/intelligence-hub/data-entry.html', label: 'Capture Feedback' },
                    { href: '/Modules/intelligence-hub/data-archive.html', label: 'Data Archive' }
                ]
            },
            {
                label: 'Collaboration',
                items: [
                    { href: '/Modules/decision-log/decision-log.html', label: 'Decision Log' },
                    { href: '/Modules/solution-brainstorm/solution-brainstorm.html', label: 'Solution Brainstorming' },
                    { href: '/Modules/meeting-strategist/meeting-center.html', label: 'Meeting' }
                ]
            },
            {
                label: 'Product Delivery',
                items: [
                    { href: '/roadmap.html', label: 'Roadmap' }
                ]
            },
            {
                label: 'Ground Truth',
                items: [
                    { href: '/epic-lifecycle.html', label: 'Epic Lifecycle' },
                    { href: '/Modules/settings/settings.html', label: 'Settings' }
                ]
            },
            {
                label: 'A/B Testing',
                items: [
                    { href: '/dashboard-v2.html', label: 'Dashboard v2' },
                    { href: '/dashboard-v3.html', label: 'Dashboard v3' }
                ]
            }
        ];

        return this.isExecutive ? executiveCategories : standardCategories;
    }

    getDynamicContent() {
        const currentPage = this.getCurrentPage();
        
        switch (currentPage) {
            case 'data-entry':
                return '';
            case 'data-archive':
                return `
                    <div class="sidebar-section-label">Statistics</div>
                    <div id="archiveStats" style="padding: 0 10px; margin-bottom: 16px;">
                        <div style="font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 4px;">Total Entries</div>
                        <div id="totalCount" style="font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--color-text-primary);">-</div>
                    </div>
                `;
            case 'analyzer':
                return `
                    <div class="sidebar-section-label">Radar History</div>
                    <div id="historyList" class="flex-1 overflow-y-auto custom-scrollbar" style="margin: 0 -2px; padding: 0 2px;"></div>
                `;
            default:
                return '';
        }
    }

    // Solution mode toggle for dashboard and data-archive
    getSolutionModeToggle() {
        if (!this.currentPath.includes('dashboard') && !this.currentPath.includes('data-archive')) return '';
        
        return `
            <div class="sidebar-section-label">Mode</div>
            <div style="padding: 0 10px; margin-bottom: 16px;">
                <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-secondary);">
                    <div class="toggle-switch">
                        <input type="checkbox" id="solutionModeToggle">
                        <span class="toggle-slider"></span>
                    </div>
                    <span>Solution Mode</span>
                </label>
            </div>
        `;
    }

    getCurrentPage() {
        if (this.currentPath.includes('data-entry')) return 'data-entry';
        if (this.currentPath.includes('data-archive')) return 'data-archive';
        if (this.currentPath.includes('analyzer')) return 'analyzer';
        return 'default';
    }

    createNavItem(item) {
        // Handle category items (with sub-items)
        if (item.items && Array.isArray(item.items)) {
            const hasActiveChild = item.items.some(child => 
                this.currentPath === child.href || 
                (child.href !== '/dashboard.html' && this.currentPath.includes(child.href))
            );
            
            const categoryHtml = `
                <li class="sidebar-category">
                    <div class="category-header ${hasActiveChild ? 'active' : ''}">
                        <span class="category-label">${item.label}</span>
                        <span class="category-arrow">▼</span>
                    </div>
                    <ul class="category-items ${hasActiveChild ? 'expanded' : ''}">
                        ${item.items.map(child => this.createSubItem(child)).join('')}
                    </ul>
                </li>
            `;
            
            return categoryHtml;
        }
        
        // Handle simple items (backward compatibility)
        const isActive = this.currentPath === item.href || 
                        (item.href !== '/dashboard.html' && this.currentPath.includes(item.href));
        const activeClass = isActive ? 'class="active"' : '';
        
        return `<li><a href="${item.href}" ${activeClass}>${item.label}</a></li>`;
    }

    createSubItem(item) {
        const isActive = this.currentPath === item.href || 
                        (item.href !== '/dashboard.html' && this.currentPath.includes(item.href));
        const activeClass = isActive ? 'class="active"' : '';
        
        return `<li><a href="${item.href}" ${activeClass}>${item.label}</a></li>`;
    }

    setupSolutionModeToggle() {
        const toggle = document.getElementById('solutionModeToggle');
        if (!toggle) return;

        // Always default to OFF - ignore any saved state
        toggle.checked = false;
        localStorage.setItem('solutionMode', 'false');
        this.updateSolutionMode(false);

        // Add event listener
        toggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem('solutionMode', isEnabled);
            this.updateSolutionMode(isEnabled);
        });
    }

    updateSolutionMode(enabled) {
        // Dispatch custom event for dashboard to listen to
        window.dispatchEvent(new CustomEvent('solutionModeChanged', { 
            detail: { enabled } 
        }));
    }

    setupCategoryToggle() {
        const categoryHeaders = document.querySelectorAll('.category-header');
        
        categoryHeaders.forEach(header => {
            header.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const category = header.parentElement;
                const items = category.querySelector('.category-items');
                const arrow = header.querySelector('.category-arrow');
                
                if (items && arrow) {
                    const isExpanded = items.classList.contains('expanded');
                    
                    // Toggle expanded state
                    items.classList.toggle('expanded');
                    
                    // Rotate arrow
                    if (isExpanded) {
                        arrow.style.transform = 'rotate(0deg)';
                    } else {
                        arrow.style.transform = 'rotate(180deg)';
                    }
                }
            });
        });
    }

    setupMobileHandlers() {
        // Add mobile menu toggle if it doesn't exist
        if (!document.querySelector('.mobile-menu-toggle')) {
            const toggle = document.createElement('button');
            toggle.className = 'mobile-menu-toggle';
            toggle.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12h18M3 6h18M3 18h18"/>
                </svg>
            `;
            toggle.onclick = () => this.toggleSidebar();
            document.body.insertBefore(toggle, document.body.firstChild);
        }

        // Add overlay if it doesn't exist
        if (!document.querySelector('.sidebar-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            overlay.onclick = () => this.closeSidebar();
            document.body.insertBefore(overlay, document.body.firstChild.nextSibling);
        }

        // Setup event listeners
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                const toggle = document.querySelector('.mobile-menu-toggle');
                
                if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
                    this.closeSidebar();
                }
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                this.closeSidebar();
            }
        });
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    }

    closeSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SidebarComponent();
});

// Export for manual initialization if needed
window.SidebarComponent = SidebarComponent;
