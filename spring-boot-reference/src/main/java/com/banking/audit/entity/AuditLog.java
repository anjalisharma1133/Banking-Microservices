package com.banking.audit.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "audit_logs")
@Data
public class AuditLog {

    @Id
    private String id;

    @PrePersist
    public void ensureId() {
        if (this.id == null) {
            this.id = java.util.UUID.randomUUID().toString();
        }
    }

    @Column(nullable = false)
    private String event;

    @Column(nullable = false)
    private LocalDateTime timestamp = LocalDateTime.now();

    @Column(nullable = false)
    private String userId;

    @Column(columnDefinition = "TEXT")
    private String metadata;
}
